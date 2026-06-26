import Foundation

public enum ConversationTier: String, CaseIterable, Codable, Sendable {
    case personal
    case confidential
    case restricted

    public var badgeTitle: String {
        switch self {
        case .personal:
            "Personal"
        case .confidential:
            "Confidential"
        case .restricted:
            "Restricted"
        }
    }
}

public enum ParticipantKind: String, Codable, Sendable {
    case member
    case guest
}

public enum ConversationLockReason: String, Codable, Sendable {
    case restrictedReentryRequired
    case dissolved
    case unavailable

    public var message: String {
        switch self {
        case .restrictedReentryRequired:
            "Restricted re-entry is required before this thread can be opened."
        case .dissolved:
            "This conversation is no longer available because the relationship was dissolved."
        case .unavailable:
            "This conversation is temporarily unavailable."
        }
    }
}

public enum ConversationAccessState: Equatable, Sendable {
    case available
    case locked(reason: ConversationLockReason)
}

public struct ConversationParticipantSummary: Identifiable, Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let kind: ParticipantKind

    public init(id: String, displayName: String, kind: ParticipantKind) {
        self.id = id
        self.displayName = displayName
        self.kind = kind
    }
}

public struct ConversationSummary: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let tier: ConversationTier
    public let participants: [ConversationParticipantSummary]
    public let lastMessagePreview: String?
    public let lastActivityAt: Date
    public let unreadCount: Int
    public let accessState: ConversationAccessState

    public init(
        id: String,
        title: String,
        tier: ConversationTier,
        participants: [ConversationParticipantSummary],
        lastMessagePreview: String?,
        lastActivityAt: Date,
        unreadCount: Int,
        accessState: ConversationAccessState
    ) {
        self.id = id
        self.title = title
        self.tier = tier
        self.participants = participants
        self.lastMessagePreview = lastMessagePreview
        self.lastActivityAt = lastActivityAt
        self.unreadCount = unreadCount
        self.accessState = accessState
    }

    public var participantSummaryText: String {
        let names = participants.prefix(2).map(\.displayName)
        let guestCount = participants.filter { $0.kind == .guest }.count
        var segments: [String] = []

        if !names.isEmpty {
            segments.append(names.joined(separator: ", "))
        }

        if participants.count > 2 {
            segments.append("+\(participants.count - 2) more")
        }

        if guestCount > 0 {
            segments.append(guestCount == 1 ? "1 guest" : "\(guestCount) guests")
        }

        if segments.isEmpty {
            return "No participants"
        }

        return segments.joined(separator: " • ")
    }
}

public struct ConversationThread: Equatable, Sendable {
    public let conversation: ConversationSummary
    public let dissolution: DissolutionViewState
    public let items: [ConversationThreadItem]

    public init(
        conversation: ConversationSummary,
        dissolution: DissolutionViewState = DissolutionViewState(status: .notAvailable, allowedActions: []),
        items: [ConversationThreadItem]
    ) {
        self.conversation = conversation
        self.dissolution = dissolution
        self.items = items.sorted { $0.createdAt < $1.createdAt }
    }
}

public enum ConversationThreadItem: Identifiable, Equatable, Sendable {
    case message(ThreadMessage)
    case timeline(ThreadTimelineEvent)

    public var id: String {
        switch self {
        case let .message(message):
            return message.id
        case let .timeline(event):
            return event.id
        }
    }

    public var createdAt: Date {
        switch self {
        case let .message(message):
            return message.createdAt
        case let .timeline(event):
            return event.createdAt
        }
    }

    public var message: ThreadMessage? {
        switch self {
        case let .message(message):
            message
        case .timeline:
            nil
        }
    }
}

public enum AttachmentAccessState: Equatable, Sendable {
    case allowed
    case downloadDisabled(reason: String)
    case notVisible
}

public struct ThreadAttachment: Identifiable, Equatable, Sendable {
    public let id: String
    public let filename: String
    public let contentType: String
    public let byteSize: Int
    public let accessState: AttachmentAccessState

    public init(
        id: String,
        filename: String,
        contentType: String,
        byteSize: Int,
        accessState: AttachmentAccessState
    ) {
        self.id = id
        self.filename = filename
        self.contentType = contentType
        self.byteSize = byteSize
        self.accessState = accessState
    }

    public var isDownloadEnabled: Bool {
        accessState == .allowed
    }

    public var accessoryTitle: String {
        switch accessState {
        case .allowed:
            "Download"
        case .downloadDisabled:
            "Download unavailable"
        case .notVisible:
            "Hidden"
        }
    }

    public var stateDetail: String? {
        switch accessState {
        case .allowed:
            nil
        case let .downloadDisabled(reason):
            reason
        case .notVisible:
            "This attachment is not visible to your account."
        }
    }
}

public extension Array where Element == ThreadAttachment {
    var visibleToUser: [ThreadAttachment] {
        filter { attachment in
            attachment.accessState != .notVisible
        }
    }
}

public struct ThreadMessage: Identifiable, Equatable, Sendable {
    public let id: String
    public let conversationId: String
    public let senderDisplayName: String
    public let senderKind: ParticipantKind
    public let body: String
    public let attachments: [ThreadAttachment]
    public let createdAt: Date

    public init(
        id: String,
        conversationId: String,
        senderDisplayName: String,
        senderKind: ParticipantKind,
        body: String,
        attachments: [ThreadAttachment] = [],
        createdAt: Date
    ) {
        self.id = id
        self.conversationId = conversationId
        self.senderDisplayName = senderDisplayName
        self.senderKind = senderKind
        self.body = body
        self.attachments = attachments.visibleToUser
        self.createdAt = createdAt
    }
}

public struct ThreadTimelineEvent: Identifiable, Equatable, Sendable {
    public let id: String
    public let conversationId: String
    public let title: String
    public let detail: String?
    public let kind: ThreadTimelineEventKind
    public let createdAt: Date

    public init(
        id: String,
        conversationId: String,
        title: String,
        detail: String?,
        kind: ThreadTimelineEventKind = .generic,
        createdAt: Date
    ) {
        self.id = id
        self.conversationId = conversationId
        self.title = title
        self.detail = detail
        self.kind = kind
        self.createdAt = createdAt
    }
}

public enum ThreadTimelineEventKind: Equatable, Sendable {
    case generic
    case dissolution(status: DissolutionStatus)
}

public enum DissolutionAction: String, CaseIterable, Equatable, Sendable {
    case request
    case confirm
    case reject
}

public enum DissolutionStatus: Equatable, Sendable {
    case notAvailable
    case available
    case pendingConfirmation(requestedByCurrentUser: Bool)
    case completed
    case rejected
}

public struct DissolutionViewState: Equatable, Sendable {
    public let status: DissolutionStatus
    public let allowedActions: Set<DissolutionAction>

    public init(status: DissolutionStatus, allowedActions: Set<DissolutionAction>) {
        self.status = status
        self.allowedActions = allowedActions
    }

    public func showsAction(_ action: DissolutionAction) -> Bool {
        allowedActions.contains(action)
    }

    public var bannerTitle: String? {
        switch status {
        case .notAvailable:
            nil
        case .available:
            "Dissolution available"
        case .pendingConfirmation:
            "Dissolution pending"
        case .completed:
            "Dissolution completed"
        case .rejected:
            "Dissolution rejected"
        }
    }

    public var bannerDetail: String? {
        switch status {
        case .notAvailable:
            nil
        case .available:
            "This conversation can be closed only through bilateral confirmation."
        case let .pendingConfirmation(requestedByCurrentUser):
            requestedByCurrentUser
                ? "Waiting for counterpart confirmation."
                : "Review the counterpart request before confirming or rejecting."
        case .completed:
            "This conversation has been closed through governed dissolution."
        case .rejected:
            "The last dissolution request was rejected."
        }
    }

    public var primaryActionTitle: String? {
        if showsAction(.confirm) {
            return "Confirm dissolution"
        }
        if showsAction(.request) {
            return "Request dissolution"
        }
        return nil
    }

    public var secondaryActionTitle: String? {
        showsAction(.reject) ? "Reject" : nil
    }
}
