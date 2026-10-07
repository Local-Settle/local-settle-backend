# Code Review Guidelines — LocalSettle Backend (NestJS)

## Overview

The primary objective of these guidelines is to ensure that every Pull Request (PR) submitted to the LocalSettle backend maintains a rigorous standard of security, architectural consistency, and auditability. Because this platform processes decentralized peer-to-peer (P2P) financial transactions and ledger data, the code must not only be performant but also completely deterministic, resilient against common vulnerabilities, and easily traceable during infrastructure audits.

This document serves as the core instruction set for the AI agent (`reviewer`) and the engineering team during the code review phase.

---

## Core Review Rules

### 1. NestJS Architecture & Decoupling

- **Rule:** Business logic, ledger mutations, and financial orchestration must never be coupled directly within `Controllers` or GraphQL Resolvers.
- **Acceptance Criteria:** Controllers must restrict their scope exclusively to request routing, input schema validation (via NestJS `ValidationPipe` and `class-validator`), and response transformation. All transactional logic, escrow processing, and rate calculations must reside within specialized, injectables `Services`.

### 2. Security & Role-Based Access Control (RBAC)

- **Rule:** Every newly exposed endpoint or resource mutation must explicitly declare an authentication and authorization layer.
- **Acceptance Criteria:** Unless explicitly documented as a public route, all endpoints must enforce identity verification via Guards (e.g., `@UseGuards(JwtAuthGuard, RolesGuard)` alongside `@Roles(Role.User)`). Furthermore, the handler must implement strict resource-ownership validation to ensure the authenticated context matches the target wallet or account being modified.

### 3. Database Operations & Concurrency (PostgreSQL / Prisma)

- **Rule:** Any data mutation involving user balances, payment routing, or P2P transaction states must execute atomically.
- **Acceptance Criteria:** Sequential, un-isolated database writes that could cause partial state failures are strictly forbidden. State mutations must be wrapped within atomic **Database Transactions** (e.g., Prisma’s `$transaction`) utilizing explicit concurrency controls to mitigate race conditions or double-spending anomalies.

### 4. Semantic Error Handling

- **Rule:** Raw runtime exceptions, stack traces, or generic `InternalServerErrorException` bubbles must never leak to the client interface for anticipated business failures.
- **Acceptance Criteria:** Domain-specific dead ends (e.g., "insufficient funds", "invalid cryptographic signature") must throw dedicated, semantic NestJS exceptions (e.g., `BadRequestException`, `ConflictException`) equipped with structured error codes. Example: `{ statusCode: 400, error: "INSUFFICIENT_FUNDS", message: "..." }`. The system must rely on a global `ExceptionFilter` to format these responses cleanly.

### 5. Structured Logging & Inmutable Audit Trails

- **Rule:** Critical milestones in the lifecycle of any P2P financial event must emit an explicit, highly structured audit log.
- **Acceptance Criteria:** Implement the native NestJS `Logger` (or an integrated structured logging engine) to trace the exact initiation, processing state, and final settlement of operations. **Crucial restriction:** Under no circumstances should private keys, credentials, or unmasked sensitive user data be printed to the stdout logs. Log structures must include searchable tracking fields like `transactionId` or `userId`.
