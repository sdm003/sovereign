import Combine
import Foundation

@MainActor
public final class ConversationListViewModel: ObservableObject {
    @Published public private(set) var conversations: [ConversationSummary] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?

    private let client: ConversationClient

    public init(client: ConversationClient) {
        self.client = client
    }

    public func load() async {
        isLoading = true
        errorMessage = nil

        do {
            let fetched = try await client.fetchConversationList()
            conversations = fetched.sorted { $0.lastActivityAt > $1.lastActivityAt }
        } catch {
            errorMessage = "Unable to load conversations."
        }

        isLoading = false
    }
}

@MainActor
public final class ConversationThreadViewModel: ObservableObject {
    @Published public private(set) var thread: ConversationThread?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var connectionId: String?

    private let client: ConversationClient
    private let realtimeClient: ConversationRealtimeClient
    private var realtimeSubscription: ConversationRealtimeSubscription?
    private var pendingRealtimeEvents: [ThreadRealtimeEvent] = []
    private var isProcessingRealtimeEvents = false

    public init(client: ConversationClient, realtimeClient: ConversationRealtimeClient) {
        self.client = client
        self.realtimeClient = realtimeClient
    }

    deinit {
        realtimeSubscription?.cancel()
    }

    public func load(conversationId: String) async {
        realtimeSubscription?.cancel()
        isLoading = true
        errorMessage = nil

        do {
            let loadedThread = try await client.fetchConversationThread(conversationId: conversationId)
            thread = loadedThread
            isLoading = false

            guard case .available = loadedThread.conversation.accessState else {
                connectionId = nil
                return
            }

            let sync = try await realtimeClient.connect()
            connectionId = sync.connectionId
            realtimeSubscription = realtimeClient.subscribe(to: conversationId) { [weak self] event in
                Task { @MainActor in
                    guard let self else { return }
                    await self.enqueue(event)
                }
            }
        } catch {
            thread = nil
            connectionId = nil
            errorMessage = "Unable to load this thread."
            isLoading = false
        }
    }

    private func enqueue(_ event: ThreadRealtimeEvent) async {
        pendingRealtimeEvents.append(event)

        guard !isProcessingRealtimeEvents else {
            return
        }

        isProcessingRealtimeEvents = true
        defer { isProcessingRealtimeEvents = false }

        while !pendingRealtimeEvents.isEmpty {
            let nextEvent = pendingRealtimeEvents.removeFirst()
            await apply(nextEvent)
        }
    }

    private func apply(_ event: ThreadRealtimeEvent) async {
        guard let currentThread = thread else {
            return
        }

        do {
            let updatedItems: [ConversationThreadItem]

            switch event {
            case let .messageCreated(conversationId, messageId):
                guard conversationId == currentThread.conversation.id else {
                    return
                }

                if currentThread.items.contains(where: { $0.id == messageId }) {
                    return
                }

                let message = try await client.fetchMessage(conversationId: conversationId, messageId: messageId)
                updatedItems = currentThread.items + [.message(message)]
            case let .timelineEvent(conversationId, eventId):
                guard conversationId == currentThread.conversation.id else {
                    return
                }

                if currentThread.items.contains(where: { $0.id == eventId }) {
                    return
                }

                let timelineEvent = try await client.fetchTimelineEvent(conversationId: conversationId, eventId: eventId)
                updatedItems = currentThread.items + [.timeline(timelineEvent)]
            }

            thread = ConversationThread(
                conversation: currentThread.conversation,
                items: updatedItems
            )
        } catch {
            errorMessage = "Realtime update could not be applied."
        }
    }
}
