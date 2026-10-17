# Backend module ownership and dependencies

This map describes the NestJS modules under `src/modules`. Keep feature rules in their owning module and use injected providers at module boundaries instead of reaching into another module's repository.

| Module | Owns | Public providers / collaborators |
| --- | --- | --- |
| `auth` | Wallet challenge, JWT issue/validation, authentication guards | `AuthService`, `JwtAuthGuard` |
| `users` | `AppUser` profile rows and account lifecycle | `UsersService` |
| `offer` | `Offer` rows and offer search/update/close | `OfferService` |
| `order` | `Order` rows, expiry and party state | `OrderService` |
| `chat-message` | `ChatMessage` rows and websocket delivery | `ChatMessageService` |
| `payment-methods` | `PaymentMethod` rows and user-owned destinations | `PaymentMethodsService` |
| `payment-providers` | Supported provider catalogue | `PaymentProvidersController` |
| `escrow` | `EscrowOnChain` rows, Trustless Work API and signing | `EscrowService`, `TrustlessWorkService` |
| `stellar` | Horizon/Soroban access, event parsing and chain synchronization | `StellarService`, `StellarListenerService` |
| `audit-log` | `AuditLog` rows, append-only security and business records | `AuditLogService` |
| `kyc` | Verification submissions and provider callbacks | `KycService` |
| `file-storage` | Object storage implementation | `FileStorageService` |
| `send` | Stellar payment submission | `SendService` |
| `stats` | Read-only aggregate statistics | `StatsService` |
| `health` | Liveness/readiness endpoints | controller only |

## Dependency direction

`offer` and `payment-methods` depend on Prisma and `audit-log`. `order` depends on `offer` state through Prisma, and calls `escrow` for chain operations; it also writes audit records. `chat-message` owns chat persistence and checks order membership through its repository. `stellar` consumes `escrow` and `order` services to apply parsed chain events. `auth` is a cross-cutting guard dependency; it should not import business feature modules. `stats` may read feature data but should not mutate it.

## Circular dependency policy

There should be no `forwardRef` or mutual module imports. When two features need to coordinate, put the shared operation in the owning feature's public service or publish a small domain event. Keep Prisma reads/writes for a feature behind its repository. Before adding an import, check both modules' `imports` and `exports`; export only providers consumed outside the module.

## Change guidance

Add a provider to the owning module's `providers` and export it only if another module injects it. Add a controller only for that module's routes. Keep transport DTOs in that module's `dto/` directory, and avoid importing another module's private DTOs or repositories.
