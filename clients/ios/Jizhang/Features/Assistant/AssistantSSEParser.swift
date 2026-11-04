import Foundation

struct AssistantSSEFrame: Equatable {
    let id: String?
    let event: String?
    let data: Data

    func decode() throws -> AssistantStreamEvent {
        let decoded = try JSONDecoder().decode(AssistantStreamEvent.self, from: data)
        if let id, Int64(id) != decoded.seq { throw AssistantProtocolError.invalidEvent }
        if let event, event != decoded.type { throw AssistantProtocolError.invalidEvent }
        return decoded
    }
}

/// Byte-oriented parser emits complete frames immediately, including CR-only streams.
struct AssistantSSEParser {
    private var line = Data()
    private var dataLines: [String] = []
    private var eventID: String?
    private var eventName: String?
    private var skipLF = false
    private var firstLine = true
    private var totalBytes = 0
    private var frameBytes = 0

    mutating func feed(_ byte: UInt8) throws -> AssistantSSEFrame? {
        totalBytes += 1
        guard totalBytes <= 2 * 1_024 * 1_024 else { throw AssistantProtocolError.oversizedStream }
        if skipLF {
            skipLF = false
            if byte == 10 { return nil }
        }
        if byte == 13 || byte == 10 {
            skipLF = byte == 13
            defer { line.removeAll(keepingCapacity: true) }
            return try finishLine()
        }
        line.append(byte)
        guard line.count <= 64 * 1_024 else { throw AssistantProtocolError.oversizedStream }
        return nil
    }

    private mutating func finishLine() throws -> AssistantSSEFrame? {
        guard var text = String(data: line, encoding: .utf8) else { throw AssistantProtocolError.invalidUTF8 }
        if firstLine { firstLine = false; if text.hasPrefix("\u{FEFF}") { text.removeFirst() } }
        if text.isEmpty {
            defer { dataLines.removeAll(keepingCapacity: true); eventID = nil; eventName = nil; frameBytes = 0 }
            guard !dataLines.isEmpty else { return nil }
            return AssistantSSEFrame(id: eventID, event: eventName, data: Data(dataLines.joined(separator: "\n").utf8))
        }
        if text.hasPrefix(":") { return nil }
        frameBytes += line.count
        guard frameBytes <= 128 * 1_024 else { throw AssistantProtocolError.oversizedStream }
        let parts = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let field = String(parts[0])
        var value = parts.count == 2 ? String(parts[1]) : ""
        if value.hasPrefix(" ") { value.removeFirst() }
        switch field {
        case "data": dataLines.append(value)
        case "id":
            guard !value.contains("\0") else { throw AssistantProtocolError.invalidEvent }
            eventID = value
        case "event": eventName = value
        default: break
        }
        return nil
    }
}
