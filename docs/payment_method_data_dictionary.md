# Architecture Definition: Payment Method Data Dictionary

## 1. Overview and Requirements

The LocalSettle platform requires a robust system to manage multiple payment methods per user to facilitate Peer-to-Peer (P2P) operations. These methods must be auto-managed, allowing users to select from pre-defined providers or register custom ones while maintaining a consistent data structure for the escrow and order matching engine.

### 1.1 Classification of Systems

Payment methods are classified into three primary categories:

- **Mobile System**: Systems tied to a phone number and personal identification (e.g., Pago Móvil, Nequi).
- **Online Platform**: Digital wallets and P2P services (e.g., PayPal, Zelle, Cash App).
- **Bank Transfer**: Traditional banking operations requiring account numbers or IBANs.

## 2. Flexibility Principle

To ensure scalability and ease of integration, the architecture employs a **Single Table Approach** for payment methods.

- **Polymorphic Mapping**: Different classifications map their specific data points into a set of shared, flexible variables.
- **UI Driven by Class**: The frontend determines which labels to show (e.g., "Phone Number" vs "Account Number") based on the `type` field, but always targets the same backend table columns.

## 3. Data Dictionary

### 3.1 Table: `payment_provider`

Stores the catalog of supported banks and platforms.

| Column         | Data Type | Nullable | Description                                                 |
| :------------- | :-------- | :------- | :---------------------------------------------------------- |
| `provider_id`  | UUID      | No       | Primary Key.                                                |
| `name`         | String    | No       | Human-readable name (e.g., "Banco de Venezuela", "PayPal"). |
| `type`         | Enum      | No       | `MOBILE`, `PLATFORM`, `BANK`.                               |
| `country_code` | String    | Yes      | ISO 3166-1 alpha-2 code for regional filtering.             |
| `is_active`    | Boolean   | No       | Default `true`. Used to enable/disable providers globally.  |
| `metadata`     | JSONB     | Yes      | Extensible field for logos, specific instructions, or URLs. |

### 3.2 Table: `payment_method`

Stores the actual account details for each user.

| Column                  | Data Type | Nullable | Description                                                                       |
| :---------------------- | :-------- | :------- | :-------------------------------------------------------------------------------- |
| `payment_id`            | UUID      | No       | Primary Key.                                                                      |
| `user_id`               | UUID      | No       | Foreign Key to `AppUser`.                                                         |
| `provider_id`           | UUID      | No       | Foreign Key to `payment_provider`.                                                |
| `type`                  | Enum      | No       | `MOBILE`, `PLATFORM`, `BANK`. Replicated for query efficiency.                    |
| `account_identifier`    | String    | No       | The primary identifier: Phone (Mobile), Email (Platform), or Account/IBAN (Bank). |
| `beneficiary_name`      | String    | Yes      | Name of the account holder/beneficiary.                                           |
| `identification_number` | String    | Yes      | Regional identification (e.g., CI, RUT, SSN).                                     |
| `description`           | String    | Yes      | Optional user-defined label or notes for the counterparty.                        |
| `is_active`             | Boolean   | No       | Default `true`. Allows users to "remove" methods without breaking order history.  |

## 4. UI/UX Mapping Strategy

| Classification | `account_identifier` Label | `identification_number` Label | `beneficiary_name` |
| :------------- | :------------------------- | :---------------------------- | :----------------- |
| **Mobile**     | Phone Number               | ID Document (CI/V)            | Optional           |
| **Platform**   | Email / ID                 | N/A                           | N/A                |
| **Bank**       | Account # / IBAN           | ID Document (Optional)        | Required           |
