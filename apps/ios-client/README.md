# iOS Client

Swift package baseline for the end-user SwiftUI client surface.

Current scope:

- conversation list and thread views
- tier badge and participant summary presentation
- restricted locked-state, timeout/revoked-key handling, and re-entry messaging
- realtime message and timeline event handling in the thread view model
- explicit attachment access states for allowed, disabled, and hidden files
- bilateral dissolution banners, action states, and timeline rendering
- preview fixtures and package tests for the initial messaging experience

Not yet included:

- Xcode app shell and navigation composition
- real API transport, auth storage, and websocket wiring
- attachment upload composition and real download transport
- production dissolution API transport
- production Restricted hardware-key challenge transport
