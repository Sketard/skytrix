---
project_name: 'skytrix'
user_name: 'Axel'
date: '2026-02-07'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 62
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Frontend

- Angular 19.1.3 (standalone components, signals, OnPush)
- Angular Material 19.1.1 + CDK
- TypeScript 5.5.4 (strict mode, target ES2022, module ES2022)
- RxJS 7.8.0
- ngx-translate 16.0.4 (i18n, default language: FR)
- ngx-toastr 19.0.0
- jspdf 2.5.1
- SCSS (style preprocessor, includePaths: src/app/styles)
- Prettier 3.4.2
- Karma 6.4 + Jasmine 5.1 (testing)

### Backend

- Java 21 / Spring Boot 3.4.2
- Spring Security + JWT (JJWT 0.12.6)
- Spring Data JPA / Hibernate (PostgreSQL dialect)
- PostgreSQL (driver 42.7.5, port 5433)
- Flyway 11.2.0 (migrations, out-of-order enabled)
- Lombok 1.18.36
- MapStruct 1.5.5 (componentModel: spring)
- Maven

### Infrastructure

- API proxy: `/api` → `localhost:8080`
- Servlet context-path: `/api`
- Image storage: `./images/small/` and `./images/big/`

## Critical Implementation Rules

### Language-Specific Rules

#### TypeScript (Frontend)

- Strict mode enabled: `strict: true`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`
- Angular strict templates: `strictTemplates: true`, `strictInjectionParameters: true`, `strictInputAccessModifiers: true`
- Target ES2022 — use modern JS features (optional chaining, nullish coalescing)
- `useDefineForClassFields: false` — required for Angular decorator compatibility, do NOT change
- Module resolution: `node` (not bundler)
- Prettier enforced: single quotes, 2-space indent, trailing comma es5, printWidth 120, arrowParens avoid, bracketSameLine true

#### Java (Backend)

- Java 21 — modern features (records, pattern matching, sealed classes) allowed where appropriate
- Use `@Inject` (Jakarta) for dependency injection — NEVER `@Autowired`
- Lombok annotations: `@Data`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor` on DTOs/entities
- MapStruct for all DTO ↔ Entity mapping — never manual mapping in services
- `@Transactional` on service methods that modify data
- `var` keyword used for local variable type inference

### Framework-Specific Rules

#### Angular (Frontend)

- ALL components MUST be `standalone: true` — no NgModules for components
- Use signal-based inputs: `input<T>()` and `output<T>()` — not `@Input()`/`@Output()` decorators
- ChangeDetection MUST be OnPush: `changeDetection: ChangeDetectionStrategy.OnPush`
- State management via signals: `signal()`, `computed()`, `.set()`, `.update()`
- Services use `@Injectable({ providedIn: 'root' })` — singleton pattern
- Reactive forms with typed FormGroup (custom `TypedForm` interface)
- HTTP interceptors are functional (not class-based): `authInterceptor`, `loaderInterceptor`
- Routing: flat route config in `app.routes.ts` — no lazy-loaded modules
- AuthService implements `canActivate` guard directly on the service class
- i18n: ngx-translate with JSON files in `assets/i18n/` (fr.json, en.json)
- Toasts via ngx-toastr for user notifications
- Component prefix: `app` (angular.json)
- Styles: SCSS with shared styles from `src/app/styles/`

#### Spring Boot (Backend)

- Layered architecture: Controller → Service → Repository
- Controllers: `@RestController` + `@RequestMapping("/resource")` with explicit `@ResponseStatus`
- Repositories: extend `CrudRepository` + `JpaSpecificationExecutor` for dynamic queries
- Mappers: abstract classes with `@Mapper(componentModel = "spring")`, use `@AfterMapping` for complex logic
- Security: stateless JWT, Bearer token, refresh via HTTP-only cookie
- Flyway migrations: `V{NNN}__description.sql` in `db/migration/flyway/`, out-of-order enabled
- External API calls: dedicated `requester` package (YGOPro API)
- Custom pagination: `CustomPageable<T>` wrapper (not Spring's Page)
- Utility methods: `CoreUtils.mapToList()`, `filter()`, `findAny()`, `getNullSafe()`

### Testing Rules

- Frontend: Karma + Jasmine — test files colocated with source as `*.spec.ts`
- Test config: `tsconfig.spec.json` with `zone.js/testing` polyfill
- Backend: Spring Boot Starter Test (JUnit 5 + Mockito)
- Component tests should use Angular TestBed with standalone component imports
- No enforced minimum coverage threshold currently

### Code Quality & Style Rules

#### File & Folder Structure

- Frontend: `components/` (reusable), `pages/` (routed views), `services/`, `core/` (directives, enums, interceptors, model, pipes, utilities)
- Backend: `controller/`, `service/`, `repository/`, `model/` (dto/, entity/, enums/), `mapper/`, `config/`, `security/`, `requester/`, `utils/`, `exception/`
- DTOs organized by domain: `dto/card/`, `dto/deck/`, `dto/user/`, `dto/yugipro/`

#### Naming Conventions

- Frontend files: kebab-case — `card-search.service.ts`, `deck-builder.component.ts`
- Frontend classes: PascalCase — `CardSearchService`, `DeckBuilderComponent`
- Frontend suffixes: `.component.ts`, `.service.ts`, `.pipe.ts`, `.directive.ts`
- Backend classes: PascalCase with suffix — `CardController`, `CardService`, `CardRepository`, `CardDTO`, `CardMapper`
- Backend methods: camelCase — `addFavorite()`, `createDeck()`
- Constants: UPPER_SNAKE_CASE — `ACCESS_TOKEN`, `AUTH_HEADER`
- Enums: PascalCase values mirroring string — `FUSION = 'FUSION'`

#### Documentation

- Minimal comments — code is self-documenting
- No JSDoc/Javadoc enforcement

### Development Workflow Rules

- Git: single `master` branch, no enforced branch naming convention
- No CI/CD pipeline detected
- Frontend dev server: `ng serve` with proxy to backend (`src/proxy.conf.json`)
- Backend: Maven build, Spring Boot run on port 8080
- Database: Flyway auto-migrates on startup (`spring.flyway.enabled=true`)
- Card data sync: manual via "Paramètres" page (fetch from YGOPro API)
- Image management: `card_images.zip` unzipped in backend folder, missing images fetched via parameters page

### Critical Don't-Miss Rules

#### Anti-Patterns to Avoid

- NEVER use NgModules — project is fully standalone components
- NEVER use `@Autowired` — always `@Inject` (Jakarta)
- NEVER use class-based interceptors — use functional interceptors
- NEVER use `@Input()`/`@Output()` decorators — use signal-based `input()`/`output()`
- NEVER use Spring's `Page`/`Pageable` — use custom `CustomPageable<T>`
- NEVER manually map DTOs in services — always use MapStruct mappers

#### Authentication Gotchas

- JWT secret is in `application.properties` — do NOT hardcode tokens elsewhere
- Access token stored in localStorage (key: `ACCESS_TOKEN`)
- Refresh token is HTTP-only cookie — NOT accessible from JavaScript
- Auth interceptor handles 401 with automatic token refresh via BehaviorSubject queue
- Login uses HTTP Basic auth (not JWT) — different from all other endpoints

#### Data Model Gotchas

- Card entity has translations (multilingual) — default display language is FR
- Card types stored as `List<String>` not enum — flexible typing
- Card images have separate small/big storage paths on disk
- Deck cards have an `index` field for ordering and a `type` field (MAIN_DECK, EXTRA_DECK, SIDE_DECK)
- Passcode is the unique external identifier for cards (from YGOPro API)

#### Security

- CORS is open (all origins) — development config, tighten for production
- CSRF disabled — API-only backend
- JWT secret in plain text in properties — use env variable for production

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review periodically for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-02-07
