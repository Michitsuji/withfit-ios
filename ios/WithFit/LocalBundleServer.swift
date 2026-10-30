import Foundation
import Network

/// WKWebView 向けに WebBundle を http://localhost:18492 で配信し、
/// Firebase Auth / IndexedDB / Web Audio / API プロキシ (/api/*) を完全動作させる軽量ネイティブサーバー
final class LocalBundleServer {
    static let shared = LocalBundleServer()

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.michitsuji.withfit.localserver", qos: .userInitiated, attributes: .concurrent)
    private(set) var port: UInt16 = 18492

    var baseURL: URL {
        return URL(string: "http://localhost:\(port)")!
    }

    var backendBaseURL: String {
        get {
            if let saved = UserDefaults.standard.string(forKey: "withfit_backend_url"), !saved.isEmpty {
                return saved.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            }
            if let plistURL = Bundle.main.object(forInfoDictionaryKey: "WithFitBackendBaseURL") as? String, !plistURL.isEmpty {
                return plistURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            }
            return "https://withfit.vercel.app"
        }
        set {
            UserDefaults.standard.set(newValue.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: "withfit_backend_url")
        }
    }

    private init() {}

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

        // 1. Handle CORS Preflight
        if method == "OPTIONS" {
            sendResponse(connection: connection, status: "200 OK", contentType: "text/plain", body: Data())
            return
        }

        // 2. Proxy /api/* requests to Vercel Backend
        if pathOnly.hasPrefix("/api/") {
            proxyAPIRequest(method: method, path: rawPath, bodyData: bodyData, connection: connection)
            return
        }

        // 3. Serve static files from WebBundle
        guard let bundleRoot = Bundle.main.resourceURL?.appendingPathComponent("WebBundle") else {
            sendResponse(connection: connection, status: "404 Not Found", contentType: "text/plain", body: Data("WebBundle missing".utf8))
            return
        }

        let cleanRelative = pathOnly == "/" ? "index.html" : String(pathOnly.dropFirst())
        let decodedRelative = cleanRelative.removingPercentEncoding ?? cleanRelative
        var targetURL = bundleRoot.appendingPathComponent(decodedRelative)

        var isDir: ObjCBool = false
        if !FileManager.default.fileExists(atPath: targetURL.path, isDirectory: &isDir) || isDir.boolValue {
            // Fallback to root resource if alarm.mp3 or icon.png
            let fileName = URL(fileURLWithPath: decodedRelative).lastPathComponent
            if let rootAsset = Bundle.main.url(forResource: fileName, withExtension: nil),
               FileManager.default.fileExists(atPath: rootAsset.path) {
                targetURL = rootAsset
            } else {
                targetURL = bundleRoot.appendingPathComponent("index.html")
            }
        }

        if let fileData = try? Data(contentsOf: targetURL) {
            let mime = mimeType(for: targetURL.pathExtension)
            sendResponse(connection: connection, status: "200 OK", contentType: mime, body: fileData)
        } else {
            sendResponse(connection: connection, status: "404 Not Found", contentType: "text/plain", body: Data("Not Found".utf8))
        }
    }

    private func proxyAPIRequest(method: String, path: String, bodyData: Data, connection: NWConnection) {
        guard let targetURL = URL(string: "\(backendBaseURL)\(path)") else {
            let errJSON = Data("{\"error\":\"Invalid backend URL\"}".utf8)
            sendResponse(connection: connection, status: "500 Internal Server Error", contentType: "application/json", body: errJSON)
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
                self.sendResponse(connection: connection, status: "502 Bad Gateway", contentType: "application/json", body: Data(msg.utf8))
                return
            }
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
            let statusText = statusCode == 200 ? "200 OK" : "\(statusCode) Response"
            self.sendResponse(connection: connection, status: statusText, contentType: "application/json", body: data ?? Data("{}".utf8))
        }.resume()
    }

    private func sendResponse(connection: NWConnection, status: String, contentType: String, body: Data) {
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        header += "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
        header += "Cache-Control: no-cache\r\n"
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
