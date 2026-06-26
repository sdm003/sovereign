import Foundation
import Testing
@testable import SovereignIOSClient

@MainActor
struct ConversationThreadViewModelTests {
    @Test
    func mapsDissolutionStatesToThreadBannersAndActions() async throws {
        let unavailable = DissolutionViewState(
            status: .notAvailable,
            allowedActions: []
        )
        let available = DissolutionViewState(
            status: .available,
            allowedActions: [.request]
        )
        let pending = DissolutionViewState(
            status: .pendingConfirmation(requestedByCurrentUser: true),
            allowedActions: []
        )
        let counterpartPending = DissolutionViewState(
            status: .pendingConfirmation(requestedByCurrentUser: false),
            allowedActions: [.confirm, .reject]
        )
        let completed = DissolutionViewState(
            status: .completed,
            allowedActions: []
        )
        let rejected = DissolutionViewState(
            status: .rejected,
            allowedActions: [.request]
        )

        #expect(unavailable.bannerTitle == nil)
        #expect(!unavailable.showsAction(.request))
        #expect(available.bannerTitle == "Dissolution available")
        #expect(available.primaryActionTitle == "Request dissolution")
        #expect(pending.bannerTitle == "Dissolution pending")
        #expect(pending.bannerDetail == "Waiting for counterpart confirmation.")
        #expect(counterpartPending.primaryActionTitle == "Confirm dissolution")
        #expect(counterpartPending.secondaryActionTitle == "Reject")
        #expect(completed.bannerTitle == "Dissolution completed")
        #expect(rejected.bannerTitle == "Dissolution rejected")
    }

    @Test
    func submitsDissolutionActionsAndRefreshesAuthoritativeThreadState() async throws {
        let conversation = ConversationSummary(
            id: "thread-dissolution",
            title: "Counterparty Thread",
            tier: .confidential,
            participants: [],
            lastMessagePreview: nil,
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 0,
            accessState: .available
        )
        let before = ConversationThread(
            conversation: conversation,
            dissolution: DissolutionViewState(status: .available, allowedActions: [.request]),
            items: []
        )
        let after = ConversationThread(
            conversation: conversation,
            dissolution: DissolutionViewState(status: .pendingConfirmation(requestedByCurrentUser: true), allowedActions: []),
            items: [
                .timeline(
                    ThreadTimelineEvent(
                        id: "dissolution-requested",
                        conversationId: conversation.id,
                        title: "Dissolution requested",
                        detail: "Waiting for counterpart confirmation.",
                        kind: .dissolution(status: .pendingConfirmation(requestedByCurrentUser: true)),
                        createdAt: Date(timeIntervalSince1970: 120)
                    )
                ),
            ]
        )
        let client = MockConversationClient(
            conversations: [conversation],
            threads: [conversation.id: before],
            messages: [:],
            timelineEvents: [:]
        )
        let realtime = MockConversationRealtimeClient()
        let viewModel = ConversationThreadViewModel(client: client, realtimeClient: realtime)

        await viewModel.load(conversationId: conversation.id)
        client.threadUpdates[conversation.id] = after
        await viewModel.submitDissolutionAction(.request)

        #expect(client.dissolutionActions == [.request])
        #expect(viewModel.thread?.dissolution.status == .pendingConfirmation(requestedByCurrentUser: true))
        #expect(viewModel.thread?.items.map(\.id) == ["dissolution-requested"])
        #expect(viewModel.errorMessage == nil)
    }

    @Test
    func preservesAuthoritativeStateWhenDissolutionActionIsDenied() async throws {
        let conversation = ConversationSummary(
            id: "thread-denied",
            title: "Denied Thread",
            tier: .confidential,
            participants: [],
            lastMessagePreview: nil,
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 0,
            accessState: .available
        )
        let thread = ConversationThread(
            conversation: conversation,
            dissolution: DissolutionViewState(status: .available, allowedActions: [.request]),
            items: []
        )
        let client = MockConversationClient(
            conversations: [conversation],
            threads: [conversation.id: thread],
            messages: [:],
            timelineEvents: [:]
        )
        client.actionError = TestClientError.dissolutionDenied
        let viewModel = ConversationThreadViewModel(
            client: client,
            realtimeClient: MockConversationRealtimeClient()
        )

        await viewModel.load(conversationId: conversation.id)
        await viewModel.submitDissolutionAction(.request)

        #expect(viewModel.thread?.dissolution.status == .available)
        #expect(viewModel.errorMessage == "Dissolution action was not accepted.")
    }

    @Test
    func mapsAttachmentAccessStatesToExplicitClientActions() async throws {
        let allowed = ThreadAttachment(
            id: "attachment-allowed",
            filename: "passport.pdf",
            contentType: "application/pdf",
            byteSize: 42_000,
            accessState: .allowed
        )
        let disabled = ThreadAttachment(
            id: "attachment-disabled",
            filename: "draft.pdf",
            contentType: "application/pdf",
            byteSize: 12_000,
            accessState: .downloadDisabled(reason: "Attachment is still processing.")
        )
        let hidden = ThreadAttachment(
            id: "attachment-hidden",
            filename: "hidden.pdf",
            contentType: "application/pdf",
            byteSize: 10_000,
            accessState: .notVisible
        )

        #expect(allowed.accessoryTitle == "Download")
        #expect(allowed.isDownloadEnabled)
        #expect(disabled.accessoryTitle == "Download unavailable")
        #expect(!disabled.isDownloadEnabled)
        #expect(hidden.accessoryTitle == "Hidden")
        #expect(!hidden.isDownloadEnabled)
        #expect([allowed, disabled, hidden].visibleToUser.map(\.id) == ["attachment-allowed", "attachment-disabled"])
    }

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
    func clearsRestrictedPayloadsReturnedWithLockedThreadResponses() async throws {
        let conversation = ConversationSummary(
            id: "restricted-locked-payload",
            title: "Restricted",
            tier: .restricted,
            participants: [],
            lastMessagePreview: "Server should not show this",
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 3,
            accessState: .locked(reason: .restrictedSessionExpired)
        )
        let leakedMessage = ThreadMessage(
            id: "locked-message",
            conversationId: conversation.id,
            senderDisplayName: "Amina",
            senderKind: .member,
            body: "Must not remain in client state",
            createdAt: Date(timeIntervalSince1970: 110)
        )
        let client = MockConversationClient(
            conversations: [conversation],
            threads: [
                conversation.id: ConversationThread(
                    conversation: conversation,
                    items: [.message(leakedMessage)]
                ),
            ],
            messages: [:],
            timelineEvents: [:]
        )
        let realtime = MockConversationRealtimeClient()
        let viewModel = ConversationThreadViewModel(client: client, realtimeClient: realtime)

        await viewModel.load(conversationId: conversation.id)

        #expect(viewModel.thread?.items.isEmpty == true)
        #expect(viewModel.thread?.conversation.lastMessagePreview == nil)
        #expect(viewModel.thread?.conversation.unreadCount == 0)
        #expect(viewModel.connectionId == nil)
        #expect(realtime.connectCallCount == 0)
    }

    @Test
    func masksRestrictedContentBeforeShowingTimeoutLockState() async throws {
        let conversation = ConversationSummary(
            id: "restricted-timeout-thread",
            title: "Restricted",
            tier: .restricted,
            participants: [
                ConversationParticipantSummary(id: "1", displayName: "Amina", kind: .member),
            ],
            lastMessagePreview: "Sensitive preview",
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 1,
            accessState: .available
        )
        let sensitiveMessage = ThreadMessage(
            id: "restricted-message",
            conversationId: conversation.id,
            senderDisplayName: "Amina",
            senderKind: .member,
            body: "Sensitive restricted body",
            createdAt: Date(timeIntervalSince1970: 110)
        )
        let thread = ConversationThread(
            conversation: conversation,
            items: [.message(sensitiveMessage)]
        )
        let client = MockConversationClient(
            conversations: [conversation],
            threads: [conversation.id: thread],
            messages: [:],
            timelineEvents: [:]
        )
        let viewModel = ConversationThreadViewModel(
            client: client,
            realtimeClient: MockConversationRealtimeClient()
        )

        await viewModel.load(conversationId: conversation.id)
        await viewModel.applyRestrictedSessionStatus(
            RestrictedSessionStatus(active: false, reason: .timeout)
        )

        #expect(viewModel.thread?.items.isEmpty == true)
        #expect(viewModel.thread?.dissolution.status == .notAvailable)
        #expect(viewModel.thread?.conversation.lastMessagePreview == nil)
        #expect(viewModel.thread?.conversation.unreadCount == 0)
        #expect(viewModel.thread?.conversation.accessState == .locked(reason: .restrictedSessionExpired))
        #expect(viewModel.connectionId == nil)
    }

    @Test
    func reentrySuccessReloadsTheIntendedRestrictedThread() async throws {
        let lockedConversation = ConversationSummary(
            id: "restricted-reentry-thread",
            title: "Restricted",
            tier: .restricted,
            participants: [],
            lastMessagePreview: nil,
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 0,
            accessState: .locked(reason: .restrictedSessionExpired)
        )
        let unlockedConversation = ConversationSummary(
            id: lockedConversation.id,
            title: "Restricted",
            tier: .restricted,
            participants: [],
            lastMessagePreview: "Unlocked preview",
            lastActivityAt: Date(timeIntervalSince1970: 120),
            unreadCount: 0,
            accessState: .available
        )
        let locked = ConversationThread(conversation: lockedConversation, items: [])
        let unlocked = ConversationThread(
            conversation: unlockedConversation,
            items: [
                .message(
                    ThreadMessage(
                        id: "restricted-unlocked-message",
                        conversationId: unlockedConversation.id,
                        senderDisplayName: "Amina",
                        senderKind: .member,
                        body: "Unlocked restricted body",
                        createdAt: Date(timeIntervalSince1970: 120)
                    )
                ),
            ]
        )
        let client = MockConversationClient(
            conversations: [lockedConversation],
            threads: [lockedConversation.id: locked],
            messages: [:],
            timelineEvents: [:]
        )
        client.reentryResults[lockedConversation.id] = .success
        let viewModel = ConversationThreadViewModel(
            client: client,
            realtimeClient: MockConversationRealtimeClient()
        )

        await viewModel.load(conversationId: lockedConversation.id)
        client.threadUpdates[lockedConversation.id] = unlocked
        await viewModel.performRestrictedReentry()

        #expect(client.reentryConversationIds == [lockedConversation.id])
        #expect(viewModel.thread?.conversation.accessState == .available)
        #expect(viewModel.thread?.items.map(\.id) == ["restricted-unlocked-message"])
        #expect(viewModel.errorMessage == nil)
    }

    @Test
    func reentryFailureKeepsThreadLockedAndHandlesRevokedKeyExplicitly() async throws {
        let conversation = ConversationSummary(
            id: "restricted-revoked-thread",
            title: "Restricted",
            tier: .restricted,
            participants: [],
            lastMessagePreview: nil,
            lastActivityAt: Date(timeIntervalSince1970: 100),
            unreadCount: 0,
            accessState: .locked(reason: .restrictedSessionExpired)
        )
        let client = MockConversationClient(
            conversations: [conversation],
            threads: [conversation.id: ConversationThread(conversation: conversation, items: [])],
            messages: [:],
            timelineEvents: [:]
        )
        client.reentryResults[conversation.id] = .denied(reason: .revokedKey)
        let viewModel = ConversationThreadViewModel(
            client: client,
            realtimeClient: MockConversationRealtimeClient()
        )

        await viewModel.load(conversationId: conversation.id)
        await viewModel.performRestrictedReentry()

        #expect(viewModel.thread?.items.isEmpty == true)
        #expect(viewModel.thread?.conversation.accessState == .locked(reason: .restrictedKeyRevoked))
        #expect(viewModel.errorMessage == "Restricted re-entry was denied because the hardware key was revoked.")
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
            attachments: [
                ThreadAttachment(
                    id: "attachment-1",
                    filename: "policy.pdf",
                    contentType: "application/pdf",
                    byteSize: 42_000,
                    accessState: .allowed
                ),
            ],
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
        #expect(viewModel.thread?.items.compactMap(\.message).first?.attachments.first?.accessoryTitle == "Download")
    }
}
