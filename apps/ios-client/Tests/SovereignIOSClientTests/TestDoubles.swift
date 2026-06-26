import Foundation
@testable import SovereignIOSClient

final class MockConversationClient: ConversationClient, @unchecked Sendable {
    let conversations: [ConversationSummary]
    let threads: [String: ConversationThread]
    let messages: [String: ThreadMessage]
    let timelineEvents: [String: ThreadTimelineEvent]
    var dissolutionActions: [DissolutionAction] = []
    var reentryConversationIds: [String] = []
    var reentryResults: [String: RestrictedReentryResult] = [:]
    var threadUpdates: [String: ConversationThread] = [:]
    var actionError: Error?

    init(
        conversations: [ConversationSummary],
        threads: [String: ConversationThread],
        messages: [String: ThreadMessage],
        timelineEvents: [String: ThreadTimelineEvent]
    ) {
        self.conversations = conversations
        self.threads = threads
        self.messages = messages
        self.timelineEvents = timelineEvents
    }

    func fetchConversationList() async throws -> [ConversationSummary] {
        conversations
    }

    func fetchConversationThread(conversationId: String) async throws -> ConversationThread {
        guard let thread = threadUpdates[conversationId] ?? threads[conversationId] else {
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

    func submitDissolutionAction(
        conversationId: String,
        action: DissolutionAction
    ) async throws -> ConversationThread {
        if let actionError {
            throw actionError
        }

        dissolutionActions.append(action)

        guard let thread = threadUpdates[conversationId] ?? threads[conversationId] else {
            throw TestClientError.missingThread
        }

        return thread
    }

    func performRestrictedReentry(conversationId: String) async throws -> RestrictedReentryResult {
        reentryConversationIds.append(conversationId)
        return reentryResults[conversationId] ?? .denied(reason: .challengeFailed)
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
    case dissolutionDenied
}
