import Foundation
import Testing
@testable import SovereignIOSClient

@MainActor
struct ConversationListViewModelTests {
    @Test
    func sortsByLastActivityAndBuildsGuestSummary() async throws {
        let older = ConversationSummary(
            id: "conversation-older",
            title: "Older",
            tier: .personal,
            participants: [
                ConversationParticipantSummary(id: "1", displayName: "Amina", kind: .member),
                ConversationParticipantSummary(id: "2", displayName: "Elena", kind: .guest),
                ConversationParticipantSummary(id: "3", displayName: "Noah", kind: .member),
            ],
            lastMessagePreview: "Older preview",
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 0,
            accessState: .available
        )
        let newer = ConversationSummary(
            id: "conversation-newer",
            title: "Newer",
            tier: .confidential,
            participants: [
                ConversationParticipantSummary(id: "4", displayName: "Maya", kind: .member),
            ],
            lastMessagePreview: "Newer preview",
            lastActivityAt: Date(timeIntervalSince1970: 200),
            unreadCount: 1,
            accessState: .available
        )
        let client = MockConversationClient(
            conversations: [older, newer],
            threads: [:],
            messages: [:],
            timelineEvents: [:]
        )
        let viewModel = ConversationListViewModel(client: client)

        await viewModel.load()

        #expect(viewModel.conversations.map(\.id) == ["conversation-newer", "conversation-older"])
        #expect(older.participantSummaryText == "Amina, Elena • +1 more • 1 guest")
    }
}
