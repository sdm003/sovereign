import SwiftUI

public struct TierBadgeView: View {
    private let tier: ConversationTier

    public init(tier: ConversationTier) {
        self.tier = tier
    }

    public var body: some View {
        Text(tier.badgeTitle)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(foregroundColor)
            .background(backgroundColor, in: Capsule())
    }

    private var foregroundColor: Color {
        switch tier {
        case .personal:
            .blue
        case .confidential:
            .orange
        case .restricted:
            .red
        }
    }

    private var backgroundColor: Color {
        foregroundColor.opacity(0.14)
    }
}

public struct ParticipantSummaryView: View {
    private let conversation: ConversationSummary

    public init(conversation: ConversationSummary) {
        self.conversation = conversation
    }

    public var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "person.2.fill")
                .foregroundStyle(.secondary)
            Text(conversation.participantSummaryText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

public struct ConversationRowView: View {
    private let conversation: ConversationSummary

    public init(conversation: ConversationSummary) {
        self.conversation = conversation
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(conversation.title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                        TierBadgeView(tier: conversation.tier)
                    }
                    ParticipantSummaryView(conversation: conversation)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 6) {
                    Text(conversation.lastActivityAt, style: .time)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if conversation.unreadCount > 0 {
                        Text("\(conversation.unreadCount)")
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .foregroundStyle(.white)
                            .background(Color.accentColor, in: Capsule())
                    }
                }
            }

            Text(conversation.lastMessagePreview ?? previewFallback)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if case let .locked(reason) = conversation.accessState {
                Label(reason.message, systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(.vertical, 4)
    }

    private var previewFallback: String {
        switch conversation.accessState {
        case .available:
            "No messages yet."
        case let .locked(reason):
            reason.message
        }
    }
}

public struct ConversationListView: View {
    @StateObject private var viewModel: ConversationListViewModel

    public init(viewModel: ConversationListViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.conversations.isEmpty {
                    ProgressView("Loading conversations...")
                } else if let errorMessage = viewModel.errorMessage, viewModel.conversations.isEmpty {
                    ContentUnavailableView("Unable to Load", systemImage: "bubble.left.and.bubble.right", description: Text(errorMessage))
                } else {
                    List(viewModel.conversations) { conversation in
                        ConversationRowView(conversation: conversation)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Conversations")
        }
        .task {
            guard viewModel.conversations.isEmpty else {
                return
            }

            await viewModel.load()
        }
    }
}

public struct ConversationThreadView: View {
    @StateObject private var viewModel: ConversationThreadViewModel
    private let conversationId: String

    public init(conversationId: String, viewModel: ConversationThreadViewModel) {
        self.conversationId = conversationId
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    public var body: some View {
        Group {
            if viewModel.isLoading && viewModel.thread == nil {
                ProgressView("Loading thread...")
            } else if let thread = viewModel.thread {
                if case let .locked(reason) = thread.conversation.accessState {
                    lockedState(reason: reason)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            header(for: thread.conversation)
                            dissolutionBanner(thread.dissolution)

                            ForEach(thread.items) { item in
                                switch item {
                                case let .message(message):
                                    messageRow(message)
                                case let .timeline(event):
                                    timelineRow(event)
                                }
                            }
                        }
                        .padding()
                    }
                }
            } else if let errorMessage = viewModel.errorMessage {
                ContentUnavailableView("Unable to Load", systemImage: "exclamationmark.bubble", description: Text(errorMessage))
            }
        }
        .task(id: conversationId) {
            await viewModel.load(conversationId: conversationId)
        }
    }

    @ViewBuilder
    private func header(for conversation: ConversationSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(conversation.title)
                    .font(.title3.weight(.semibold))
                TierBadgeView(tier: conversation.tier)
            }

            ParticipantSummaryView(conversation: conversation)

            if let connectionId = viewModel.connectionId {
                Text("Connected • \(connectionId)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func dissolutionBanner(_ dissolution: DissolutionViewState) -> some View {
        if let title = dissolution.bannerTitle {
            VStack(alignment: .leading, spacing: 8) {
                Label(title, systemImage: "person.2.badge.gearshape")
                    .font(.subheadline.weight(.semibold))
                if let detail = dissolution.bannerDetail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    if let primaryActionTitle = dissolution.primaryActionTitle {
                        Button(primaryActionTitle) {
                            let action: DissolutionAction = dissolution.showsAction(.confirm) ? .confirm : .request
                            Task {
                                await viewModel.submitDissolutionAction(action)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isSubmittingDissolutionAction)
                    }
                    if let secondaryActionTitle = dissolution.secondaryActionTitle {
                        Button(secondaryActionTitle) {
                            Task {
                                await viewModel.submitDissolutionAction(.reject)
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(viewModel.isSubmittingDissolutionAction)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    @ViewBuilder
    private func lockedState(reason: ConversationLockReason) -> some View {
        VStack(spacing: 16) {
            ContentUnavailableView(
                "Restricted Thread Locked",
                systemImage: "lock.shield",
                description: Text(reason.message)
            )
            Button("Re-authenticate") {
                Task {
                    await viewModel.performRestrictedReentry()
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isPerformingRestrictedReentry)
        }
        .padding()
    }

    @ViewBuilder
    private func messageRow(_ message: ThreadMessage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(message.senderDisplayName)
                    .font(.subheadline.weight(.semibold))
                if message.senderKind == .guest {
                    Text("Guest")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.12), in: Capsule())
                }
                Spacer()
                Text(message.createdAt, style: .time)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(message.body)
                .font(.body)

            ForEach(message.attachments) { attachment in
                attachmentRow(attachment)
            }
        }
        .padding()
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func attachmentRow(_ attachment: ThreadAttachment) -> some View {
        HStack(spacing: 10) {
            Image(systemName: attachment.isDownloadEnabled ? "paperclip" : "lock.doc")
                .foregroundStyle(attachment.isDownloadEnabled ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.filename)
                    .font(.footnote.weight(.semibold))
                if let detail = attachment.stateDetail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(attachment.accessoryTitle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(attachment.isDownloadEnabled ? Color.accentColor : Color.secondary)
        }
        .padding(.top, 6)
    }

    @ViewBuilder
    private func timelineRow(_ event: ThreadTimelineEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(event.title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(timelineForeground(for: event))
            if let detail = event.detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text(event.createdAt, style: .time)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private func timelineForeground(for event: ThreadTimelineEvent) -> Color {
        switch event.kind {
        case .generic:
            .secondary
        case .dissolution:
            .orange
        }
    }
}

#if DEBUG
struct ConversationListView_Previews: PreviewProvider {
    static var previews: some View {
        ConversationListView(
            viewModel: ConversationListViewModel(
                client: PreviewConversationClient(
                    conversations: PreviewFixtures.conversations,
                    threads: PreviewFixtures.threads
                )
            )
        )
    }
}

struct ConversationThreadView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ConversationThreadView(
                conversationId: PreviewFixtures.availableConversation.id,
                viewModel: ConversationThreadViewModel(
                    client: PreviewConversationClient(
                        conversations: PreviewFixtures.conversations,
                        threads: PreviewFixtures.threads
                    ),
                    realtimeClient: PreviewConversationRealtimeClient()
                )
            )
            ConversationThreadView(
                conversationId: PreviewFixtures.lockedConversation.id,
                viewModel: ConversationThreadViewModel(
                    client: PreviewConversationClient(
                        conversations: PreviewFixtures.conversations,
                        threads: PreviewFixtures.threads
                    ),
                    realtimeClient: PreviewConversationRealtimeClient()
                )
            )
            ConversationThreadView(
                conversationId: PreviewFixtures.timeoutLockedConversation.id,
                viewModel: ConversationThreadViewModel(
                    client: PreviewConversationClient(
                        conversations: PreviewFixtures.conversations,
                        threads: PreviewFixtures.threads
                    ),
                    realtimeClient: PreviewConversationRealtimeClient()
                )
            )
            ConversationThreadView(
                conversationId: PreviewFixtures.revokedKeyConversation.id,
                viewModel: ConversationThreadViewModel(
                    client: PreviewConversationClient(
                        conversations: PreviewFixtures.conversations,
                        threads: PreviewFixtures.threads
                    ),
                    realtimeClient: PreviewConversationRealtimeClient()
                )
            )
        }
    }
}
#endif
