import Foundation
import Testing
@testable import SovereignIOSClient

@MainActor
struct ConversationThreadViewModelTests {
    @Test
    func keepsRestrictedThreadsOfflineWhenLocked() async throws {
        let conversation = ConversationSummary(
            id: "restricted-thread",
            title: "Restricted",
            tier: .restricted,
            participants: [],
            lastMessagePreview: nil,
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 0,
            accessState: .locked(reason: .restrictedReentryRequired)
        )
        let thread = ConversationThread(conversation: conversation, items: [])
        let client = MockConversationClient(
            conversations: [conversation],
            threads: [conversation.id: thread],
            messages: [:],
            timelineEvents: [:]
        )
        let realtime = MockConversationRealtimeClient()
        let viewModel = ConversationThreadViewModel(client: client, realtimeClient: realtime)

        await viewModel.load(conversationId: conversation.id)

        #expect(viewModel.thread?.conversation.accessState == .locked(reason: .restrictedReentryRequired))
        #expect(viewModel.connectionId == nil)
        #expect(realtime.connectCallCount == 0)
    }

    @Test
    func appendsRealtimeMessagesAndTimelineEventsWithoutDuplicates() async throws {
        let conversation = ConversationSummary(
            id: "thread-1",
            title: "Confidential Thread",
            tier: .confidential,
            participants: [
                ConversationParticipantSummary(id: "1", displayName: "Amina", kind: .member),
            ],
            lastMessagePreview: "Initial preview",
            lastActivityAt: Date(timeIntervalSince1970: 300),
            unreadCount: 0,
            accessState: .available
        )
        let initialMessage = ThreadMessage(
            id: "message-1",
            conversationId: conversation.id,
            senderDisplayName: "Amina",
            senderKind: .member,
            body: "Initial message",
            createdAt: Date(timeIntervalSince1970: 100)
        )
        let appendedMessage = ThreadMessage(
            id: "message-2",
            conversationId: conversation.id,
            senderDisplayName: "Elena",
            senderKind: .guest,
            body: "Realtime message",
            createdAt: Date(timeIntervalSince1970: 200)
        )
        let appendedEvent = ThreadTimelineEvent(
            id: "event-1",
            conversationId: conversation.id,
            title: "Tier acknowledged",
            detail: nil,
            createdAt: Date(timeIntervalSince1970: 150)
        )
        let thread = ConversationThread(
            conversation: conversation,
            items: [.message(initialMessage)]
        )
        let client = MockConversationClient(
            conversations: [conversation],
            threads: [conversation.id: thread],
            messages: [appendedMessage.id: appendedMessage],
            timelineEvents: [appendedEvent.id: appendedEvent]
        )
        let realtime = MockConversationRealtimeClient()
        let viewModel = ConversationThreadViewModel(client: client, realtimeClient: realtime)

        await viewModel.load(conversationId: conversation.id)
        await realtime.send(.messageCreated(conversationId: conversation.id, messageId: appendedMessage.id))
        await realtime.send(.timelineEvent(conversationId: conversation.id, eventId: appendedEvent.id))
        await realtime.send(.messageCreated(conversationId: conversation.id, messageId: appendedMessage.id))
        await realtime.drain()

        #expect(viewModel.connectionId == "test-connection")
        #expect(viewModel.thread?.items.map(\.id) == ["message-1", "event-1", "message-2"])
    }
}
