import Foundation

public enum PreviewFixtures {
    public static let availableConversation = ConversationSummary(
        id: "conversation-1",
        title: "Family Office Planning",
        tier: .confidential,
        participants: [
            ConversationParticipantSummary(id: "user-1", displayName: "Amina", kind: .member),
            ConversationParticipantSummary(id: "user-2", displayName: "Noah", kind: .member),
            ConversationParticipantSummary(id: "user-3", displayName: "Elena", kind: .guest),
        ],
        lastMessagePreview: "The KYC package is ready for review.",
        lastActivityAt: Date(timeIntervalSince1970: 1_715_000_000),
        unreadCount: 2,
        accessState: .available
    )

    public static let lockedConversation = ConversationSummary(
        id: "conversation-2",
        title: "Restricted Governance Channel",
        tier: .restricted,
        participants: [
            ConversationParticipantSummary(id: "user-1", displayName: "Amina", kind: .member),
            ConversationParticipantSummary(id: "user-4", displayName: "Office Admin", kind: .member),
        ],
        lastMessagePreview: nil,
        lastActivityAt: Date(timeIntervalSince1970: 1_715_000_500),
        unreadCount: 0,
        accessState: .locked(reason: .restrictedReentryRequired)
    )

    public static let conversations: [ConversationSummary] = [
        lockedConversation,
        availableConversation,
    ]

    public static let threads: [String: ConversationThread] = [
        availableConversation.id: ConversationThread(
            conversation: availableConversation,
            items: [
                .timeline(
                    ThreadTimelineEvent(
                        id: "timeline-1",
                        conversationId: availableConversation.id,
                        title: "Participant invited",
                        detail: "Elena joined as a guest participant.",
                        createdAt: Date(timeIntervalSince1970: 1_714_999_700)
                    )
                ),
                .message(
                    ThreadMessage(
                        id: "message-1",
                        conversationId: availableConversation.id,
                        senderDisplayName: "Amina",
                        senderKind: .member,
                        body: "The KYC package is ready for review.",
                        createdAt: Date(timeIntervalSince1970: 1_714_999_900)
                    )
                ),
                .message(
                    ThreadMessage(
                        id: "message-2",
                        conversationId: availableConversation.id,
                        senderDisplayName: "Elena",
                        senderKind: .guest,
                        body: "Received. I will confirm the supporting documents tonight.",
                        createdAt: Date(timeIntervalSince1970: 1_715_000_000)
                    )
                ),
            ]
        ),
        lockedConversation.id: ConversationThread(
            conversation: lockedConversation,
            items: []
        ),
    ]
}
