// swift-tools-version: 6.2
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "SovereignIOSClient",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "SovereignIOSClient",
            targets: ["SovereignIOSClient"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-testing.git", from: "0.12.0"),
    ],
    targets: [
        .target(
            name: "SovereignIOSClient"
        ),
        .testTarget(
            name: "SovereignIOSClientTests",
            dependencies: [
                "SovereignIOSClient",
                .product(name: "Testing", package: "swift-testing"),
            ]
        ),
    ]
)
