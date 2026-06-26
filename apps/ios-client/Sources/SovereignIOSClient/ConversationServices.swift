import Foundation

public struct RealtimeStateSync: Equatable, Sendable {
    public let connectionId: String
    public let subscribedConversationIds: [String]

    public init(connectionId: String, subscribedConversationIds: [String]) {
        self.connectionId = connectionId
        self.subscribedConversationIds = subscribedConversationIds
    }
}

public enum ThreadRealtimeEvent: Equatable, Sendable {
    case messageCreated(conversationId: String, messageId: String)
    case timelineEvent(conversationId: String, eventId: String)
}

public protocol ConversationClient: Sendable {
    func fetchConversationList() async throws -> [ConversationSummary]
    func fetchConversationThread(conversationId: String) async throws -> ConversationThread
    func fetchMessage(conversationId: String, messageId: String) async throws -> ThreadMessage
    func fetchTimelineEvent(conversationId: String, eventId: String) async throws -> ThreadTimelineEvent
    func submitDissolutionAction(
        conversationId: String,
        action: DissolutionAction
    ) async throws -> ConversationThread
}

public protocol ConversationRealtimeClient: Sendable {
    func connect() async throws -> RealtimeStateSync
    func subscribe(
        to conversationId: String,
        onEvent: @escaping @Sendable (ThreadRealtimeEvent) -> Void
    ) -> ConversationRealtimeSubscription
}

public protocol ConversationRealtimeSubscription: Sendable {
    func cancel()
}

public final class RealtimeSubscriptionToken: ConversationRealtimeSubscription, @unchecked Sendable {
    private let onCancel: @Sendable () -> Void

    public init(onCancel: @escaping @Sendable () -> Void) {
        self.onCancel = onCancel
    }

    public func cancel() {
        onCancel()
    }
}

public struct PreviewConversationClient: ConversationClient {
    private let conversations: [ConversationSummary]
    private let threads: [String: ConversationThread]

    public init(conversations: [ConversationSummary], threads: [String: ConversationThread]) {
        self.conversations = conversations
        self.threads = threads
    }

    public func fetchConversationList() async throws -> [ConversationSummary] {
        conversations
    }

    public func fetchConversationThread(conversationId: String) async throws -> ConversationThread {
        guard let thread = threads[conversationId] else {
            throw PreviewDataError.missingThread
        }

        return thread
    }

    public func fetchMessage(conversationId: String, messageId: String) async throws -> ThreadMessage {
        guard
            let thread = threads[conversationId],
            case let .message(message)? = thread.items.first(where: { $0.id == messageId })
        else {
            throw PreviewDataError.missingMessage
        }

        return message
    }

    public func fetchTimelineEvent(conversationId: String, eventId: String) async throws -> ThreadTimelineEvent {
        guard
            let thread = threads[conversationId],
            case let .timeline(event)? = thread.items.first(where: { $0.id == eventId })
        else {
            throw PreviewDataError.missingTimelineEvent
        }

        return event
    }

    public func submitDissolutionAction(
        conversationId: String,
        action: DissolutionAction
    ) async throws -> ConversationThread {
        _ = action
        return try await fetchConversationThread(conversationId: conversationId)
    }
}

public struct PreviewConversationRealtimeClient: ConversationRealtimeClient {
    public init() {}

    public func connect() async throws -> RealtimeStateSync {
        RealtimeStateSync(connectionId: "preview-connection", subscribedConversationIds: [])
    }

    public func subscribe(
        to conversationId: String,
        onEvent: @escaping @Sendable (ThreadRealtimeEvent) -> Void
    ) -> ConversationRealtimeSubscription {
        _ = onEvent
        return RealtimeSubscriptionToken {}
    }
}

public enum PreviewDataError: Error {
    case missingThread
    case missingMessage
    case missingTimelineEvent
}
