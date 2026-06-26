import Foundation
@testable import SovereignIOSClient

struct MockConversationClient: ConversationClient {
    let conversations: [ConversationSummary]
    let threads: [String: ConversationThread]
    let messages: [String: ThreadMessage]
    let timelineEvents: [String: ThreadTimelineEvent]

    func fetchConversationList() async throws -> [ConversationSummary] {
        conversations
    }

    func fetchConversationThread(conversationId: String) async throws -> ConversationThread {
        guard let thread = threads[conversationId] else {
            throw TestClientError.missingThread
        }

        return thread
    }

    func fetchMessage(conversationId: String, messageId: String) async throws -> ThreadMessage {
        guard let message = messages[messageId], message.conversationId == conversationId else {
            throw TestClientError.missingMessage
        }

        return message
    }

    func fetchTimelineEvent(conversationId: String, eventId: String) async throws -> ThreadTimelineEvent {
        guard let event = timelineEvents[eventId], event.conversationId == conversationId else {
            throw TestClientError.missingTimelineEvent
        }

        return event
    }
}

final class MockConversationRealtimeClient: ConversationRealtimeClient, @unchecked Sendable {
    private var handlers: [String: @Sendable (ThreadRealtimeEvent) -> Void] = [:]
    private(set) var connectCallCount = 0

    func connect() async throws -> RealtimeStateSync {
        connectCallCount += 1
        return RealtimeStateSync(connectionId: "test-connection", subscribedConversationIds: [])
    }

    func subscribe(
        to conversationId: String,
        onEvent: @escaping @Sendable (ThreadRealtimeEvent) -> Void
    ) -> ConversationRealtimeSubscription {
        handlers[conversationId] = onEvent
        return RealtimeSubscriptionToken { [weak self] in
            self?.handlers[conversationId] = nil
        }
    }

    func send(_ event: ThreadRealtimeEvent) async {
        switch event {
        case let .messageCreated(conversationId, _),
             let .timelineEvent(conversationId, _):
            handlers[conversationId]?(event)
        }
    }

    func drain() async {
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
}

enum TestClientError: Error {
    case missingThread
    case missingMessage
    case missingTimelineEvent
}
