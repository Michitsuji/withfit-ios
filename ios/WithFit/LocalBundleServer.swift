import Foundation
import Network

/// WebBundle を起動時にオンメモリ（RAM）へプリロードし、
/// 0.1ms の超高速レスポンスと WebKit バイトコードキャッシュを提供するローカルサーバー
final class LocalBundleServer {
    static let shared = LocalBundleServer()

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.michitsuji.withfit.localserver", qos: .userInteractive, attributes: .concurrent)
    private(set) var port: UInt16 = 18492
    private var memoryCache: [String: (mime: String, data: Data)] = [:]

    var baseURL: URL {
        return URL(string: "http://localhost:\(port)")!
    }

    // バックエンドURLは固定（旧開発者メニューの UserDefaults 上書きは廃止）。
    // ビルド時に差し替える場合のみ Info.plist の WithFitBackendBaseURL を使う。
    var backendBaseURL: String {
        if let plistURL = Bundle.main.object(forInfoDictionaryKey: "WithFitBackendBaseURL") as? String, !plistURL.isEmpty {
            return plistURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
        return "https://withfit.vercel.app"
    }

    private init() {
        preloadBundleIntoRAM()
    }

    private func preloadBundleIntoRAM() {
        guard let bundleRoot = Bundle.main.resourceURL?.appendingPathComponent("WebBundle") else { return }
        let fm = FileManager.default
        if let enumerator = fm.enumerator(at: bundleRoot, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) {
            for case let fileURL as URL in enumerator {
                if let isFile = try? fileURL.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile, isFile == true {
                    let relPath = fileURL.path.replacingOccurrences(of: bundleRoot.path + "/", with: "")
                    if let data = try? Data(contentsOf: fileURL) {
                        memoryCache[relPath] = (mime: mimeType(for: fileURL.pathExtension), data: data)
                    }
                }
            }
        }
        if let alarmURL = Bundle.main.url(forResource: "alarm", withExtension: "mp3"),
           let data = try? Data(contentsOf: alarmURL) {
            memoryCache["alarm.mp3"] = (mime: "audio/mpeg", data: data)
        }
    }

    func start() {
        if listener != nil { return }
        startListening(on: 18492)
    }

    private func startListening(on targetPort: UInt16) {
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            let nwPort = NWEndpoint.Port(rawValue: targetPort)!
            let newListener = try NWListener(using: params, on: nwPort)
            self.port = targetPort

            newListener.newConnectionHandler = { [weak self] connection in
                self?.handleConnection(connection)
            }

            newListener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .failed(_):
                    newListener.cancel()
                    self?.listener = nil
                    if targetPort < 18500 {
                        self?.startListening(on: targetPort + 1)
                    }
                default:
                    break
                }
            }

            newListener.start(queue: queue)
            self.listener = newListener
        } catch {
            if targetPort < 18500 {
                startListening(on: targetPort + 1)
            }
        }
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveFullHTTPRequest(from: connection, accumulated: Data())
    }

    private func receiveFullHTTPRequest(from connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else {
                connection.cancel()
                return
            }
            var buffer = accumulated
            if let d = data {
                buffer.append(d)
            }

            if let headerEndRange = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = buffer.subdata(in: 0..<headerEndRange.lowerBound)
                let headerStr = String(data: headerData, encoding: .utf8) ?? ""
                let contentLength = self.parseContentLength(from: headerStr)
                let bodyStartIndex = headerEndRange.upperBound
                let currentBodyLength = buffer.count - bodyStartIndex

                if currentBodyLength < contentLength && !isComplete && error == nil {
                    self.receiveFullHTTPRequest(from: connection, accumulated: buffer)
                    return
                }
                let bodyData = buffer.subdata(in: bodyStartIndex..<min(buffer.count, bodyStartIndex + contentLength))
                self.processHTTPRequest(headerString: headerStr, bodyData: bodyData, connection: connection)
            } else if !isComplete && error == nil && buffer.count < 262144 {
                self.receiveFullHTTPRequest(from: connection, accumulated: buffer)
            } else {
                connection.cancel()
            }
        }
    }

    private func parseContentLength(from headers: String) -> Int {
        for line in headers.components(separatedBy: "\r\n") {
            let lower = line.lowercased()
            if lower.hasPrefix("content-length:") {
                let val = lower.replacingOccurrences(of: "content-length:", with: "").trimmingCharacters(in: .whitespaces)
                return Int(val) ?? 0
            }
        }
        return 0
    }

    private func processHTTPRequest(headerString: String, bodyData: Data, connection: NWConnection) {
        let lines = headerString.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            connection.cancel()
            return
        }
        let parts = requestLine.components(separatedBy: " ")
        guard parts.count >= 2 else {
            connection.cancel()
            return
        }
        let method = parts[0].uppercased()
        let rawPath = parts[1]
        let pathOnly = rawPath.components(separatedBy: "?").first ?? "/"

        if method == "OPTIONS" {
            sendResponse(connection: connection, status: "200 OK", contentType: "text/plain", body: Data(), isStaticAsset: false)
            return
        }

        if pathOnly.hasPrefix("/api/") {
            proxyAPIRequest(method: method, path: rawPath, bodyData: bodyData, connection: connection)
            return
        }

        let cleanRelative = pathOnly == "/" ? "index.html" : String(pathOnly.dropFirst())
        let decodedRelative = cleanRelative.removingPercentEncoding ?? cleanRelative
        let isHashedStatic = decodedRelative.hasPrefix("static/")

        // 1. RAMキャッシュから0.1msで即時応答
        if let cached = memoryCache[decodedRelative] {
            sendResponse(connection: connection, status: "200 OK", contentType: cached.mime, body: cached.data, isStaticAsset: isHashedStatic)
            return
        }
        if let indexCached = memoryCache["index.html"], !decodedRelative.contains(".") {
            sendResponse(connection: connection, status: "200 OK", contentType: indexCached.mime, body: indexCached.data, isStaticAsset: false)
            return
        }

        // 2. フォールバックでディスクから取得
        guard let bundleRoot = Bundle.main.resourceURL?.appendingPathComponent("WebBundle") else {
            sendResponse(connection: connection, status: "404 Not Found", contentType: "text/plain", body: Data("WebBundle missing".utf8), isStaticAsset: false)
            return
        }

        var targetURL = bundleRoot.appendingPathComponent(decodedRelative)
        var isDir: ObjCBool = false
        if !FileManager.default.fileExists(atPath: targetURL.path, isDirectory: &isDir) || isDir.boolValue {
            targetURL = bundleRoot.appendingPathComponent("index.html")
        }

        if let fileData = try? Data(contentsOf: targetURL) {
            let mime = mimeType(for: targetURL.pathExtension)
            sendResponse(connection: connection, status: "200 OK", contentType: mime, body: fileData, isStaticAsset: isHashedStatic)
        } else {
            sendResponse(connection: connection, status: "404 Not Found", contentType: "text/plain", body: Data("Not Found".utf8), isStaticAsset: false)
        }
    }

    private func proxyAPIRequest(method: String, path: String, bodyData: Data, connection: NWConnection) {
        guard let targetURL = URL(string: "\(backendBaseURL)\(path)") else {
            let errJSON = Data("{\"error\":\"Invalid backend URL\"}".utf8)
            sendResponse(connection: connection, status: "500 Internal Server Error", contentType: "application/json", body: errJSON, isStaticAsset: false)
            return
        }

        var request = URLRequest(url: targetURL)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !bodyData.isEmpty && (method == "POST" || method == "PUT") {
            request.httpBody = bodyData
        }

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            if let error = error {
                let msg = "{\"success\":false,\"error\":\"\(error.localizedDescription)\"}"
                self.sendResponse(connection: connection, status: "502 Bad Gateway", contentType: "application/json", body: Data(msg.utf8), isStaticAsset: false)
                return
            }
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
            let statusText = statusCode == 200 ? "200 OK" : "\(statusCode) Response"
            self.sendResponse(connection: connection, status: statusText, contentType: "application/json", body: data ?? Data("{}".utf8), isStaticAsset: false)
        }.resume()
    }

    private func sendResponse(connection: NWConnection, status: String, contentType: String, body: Data, isStaticAsset: Bool) {
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        header += "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
        header += isStaticAsset ? "Cache-Control: public, max-age=31536000, immutable\r\n" : "Cache-Control: no-cache\r\n"
        header += "Connection: close\r\n\r\n"

        var responseData = Data(header.utf8)
        responseData.append(body)

        connection.send(content: responseData, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }
}
