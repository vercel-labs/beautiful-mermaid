/**
 * Sample definitions for the beautiful-mermaid visual test suite.
 *
 * Shared by:
 *   - index.ts     — generates the HTML visual test page
 *   - bench.ts     — runs performance benchmarks in Bun (no browser)
 *   - dev.ts       — dev server with live reload
 *
 * Every supported feature, shape, edge type, block construct, and theme
 * variant is exercised by at least one sample.
 */

export interface Sample {
  title: string
  description: string
  source: string
  /** Optional category tag for grouping in the Table of Contents */
  category?: string
  options?: { bg?: string; fg?: string; line?: string; accent?: string; muted?: string; surface?: string; border?: string; font?: string; padding?: number; transparent?: boolean; animate?: boolean | { nodeAnimation?: string; edgeAnimation?: string; duration?: number; stagger?: number; groupDelay?: number; nodeOverlap?: number; nodeEasing?: string; edgeEasing?: string; reducedMotion?: boolean } }
}

export const samples: Sample[] = [

  // ══════════════════════════════════════════════════════════════════════════
  //  HERO — Showcase diagram
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Beautiful Mermaid',
    category: 'Hero',
    description: 'Mermaid rendering, made beautiful.',
    source: `stateDiagram-v2
    direction LR
    [*] --> Input
    Input --> Parse: DSL
    Parse --> Layout: AST
    Layout --> SVG: Vector
    Layout --> ASCII: Text
    SVG --> Theme
    ASCII --> Theme
    Theme --> Output
    Output --> [*]`,
    options: { transparent: true },
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Shapes
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Simple Flow',
    category: 'Flowchart',
    description: 'Basic linear flow with three nodes connected by solid arrows.',
    source: `graph TD
  A[Start] --> B[Process] --> C[End]`,
  },
  {
    title: 'Original Node Shapes',
    category: 'Flowchart',
    description: 'Rectangle, rounded, diamond, stadium, and circle.',
    source: `graph LR
  A[Rectangle] --> B(Rounded)
  B --> C{Diamond}
  C --> D([Stadium])
  D --> E((Circle))`,
  },
  {
    title: 'Batch 1 Shapes',
    category: 'Flowchart',
    description: 'Subroutine `[[text]]`, double circle `(((text)))`, and hexagon `{{text}}`.',
    source: `graph LR
  A[[Subroutine]] --> B(((Double Circle)))
  B --> C{{Hexagon}}`,
  },
  {
    title: 'Batch 2 Shapes',
    category: 'Flowchart',
    description: 'Cylinder `[(text)]`, asymmetric `>text]`, trapezoid `[/text\\]`, and inverse trapezoid `[\\text/]`.',
    source: `graph LR
  A[(Database)] --> B>Flag Shape]
  B --> C[/Wider Bottom\\]
  C --> D[\\Wider Top/]`,
  },
  {
    title: 'All 12 Flowchart Shapes',
    category: 'Flowchart',
    description: 'Every supported flowchart shape in a single diagram.',
    source: `graph LR
  A[Rectangle] --> B(Rounded)
  B --> C{Diamond}
  C --> D([Stadium])
  D --> E((Circle))
  E --> F[[Subroutine]]
  F --> G(((Double Circle)))
  G --> H{{Hexagon}}
  H --> I[(Database)]
  I --> J>Flag]
  J --> K[/Trapezoid\\]
  K --> L[\\Inverse Trap/]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Edges
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'All Edge Styles',
    category: 'Flowchart',
    description: 'Solid, dotted, and thick arrows with labels.',
    source: `graph TD
  A[Source] -->|solid| B[Target 1]
  A -.->|dotted| C[Target 2]
  A ==>|thick| D[Target 3]`,
  },
  {
    title: 'No-Arrow Edges',
    category: 'Flowchart',
    description: 'Lines without arrowheads: solid `---`, dotted `-.-`, thick `===`.',
    source: `graph TD
  A[Node 1] ---|related| B[Node 2]
  B -.- C[Node 3]
  C === D[Node 4]`,
  },
  {
    title: 'Bidirectional Arrows',
    category: 'Flowchart',
    description: 'Arrows in both directions: `<-->`, `<-.->`, `<==>`.',
    source: `graph LR
  A[Client] <-->|sync| B[Server]
  B <-.->|heartbeat| C[Monitor]
  C <==>|data| D[Storage]`,
  },
  {
    title: 'Parallel Links (&)',
    category: 'Flowchart',
    description: 'Using `&` to create multiple edges from/to groups of nodes.',
    source: `graph TD
  A[Input] & B[Config] --> C[Processor]
  C --> D[Output] & E[Log]`,
  },
  {
    title: 'Chained Edges',
    category: 'Flowchart',
    description: 'A long chain of nodes demonstrating edge chaining syntax.',
    source: `graph LR
  A[Step 1] --> B[Step 2] --> C[Step 3] --> D[Step 4] --> E[Step 5]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Directions
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Direction: Left-Right (LR)',
    category: 'Flowchart',
    description: 'Horizontal layout flowing left to right.',
    source: `graph LR
  A[Input] --> B[Transform] --> C[Output]`,
  },
  {
    title: 'Direction: Bottom-Top (BT)',
    category: 'Flowchart',
    description: 'Vertical layout flowing from bottom to top.',
    source: `graph BT
  A[Foundation] --> B[Layer 2] --> C[Top]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Subgraphs
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Subgraphs',
    category: 'Flowchart',
    description: 'Grouped nodes inside labeled subgraph containers.',
    source: `graph TD
  subgraph Frontend
    A[React App] --> B[State Manager]
  end
  subgraph Backend
    C[API Server] --> D[Database]
  end
  B --> C`,
  },
  {
    title: 'Nested Subgraphs',
    category: 'Flowchart',
    description: 'Subgraphs inside subgraphs for hierarchical grouping.',
    source: `graph TD
  subgraph Cloud
    subgraph us-east [US East Region]
      A[Web Server] --> B[App Server]
    end
    subgraph us-west [US West Region]
      C[Web Server] --> D[App Server]
    end
  end
  E[Load Balancer] --> A
  E --> C`,
  },
  {
    title: 'Subgraph Direction Override',
    category: 'Flowchart',
    description: 'Using `direction LR` inside a subgraph while the outer graph flows TD.',
    source: `graph TD
  subgraph pipeline [Processing Pipeline]
    direction LR
    A[Input] --> B[Parse] --> C[Transform] --> D[Output]
  end
  E[Source] --> A
  D --> F[Sink]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Styling
  // ══════════════════════════════════════════════════════════════════════════


  {
    title: 'Inline Style Overrides',
    category: 'Flowchart',
    description: 'Using `style` statements to override node fill and stroke colors.',
    source: `graph TD
  A[Default] --> B[Custom Colors] --> C[Another Custom]
  style B fill:#3b82f6,stroke:#1d4ed8,color:#ffffff
  style C fill:#10b981,stroke:#059669`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOWCHART — Real-World Diagrams
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'CI/CD Pipeline',
    category: 'Flowchart',
    description: 'A realistic CI/CD pipeline with decision points, feedback loops, and deployment stages.',
    source: `graph TD
  subgraph ci [CI Pipeline]
    A[Push Code] --> B{Tests Pass?}
    B -->|Yes| C[Build Image]
    B -->|No| D[Fix & Retry]
    D -.-> A
  end
  C --> E([Deploy Staging])
  E --> F{QA Approved?}
  F -->|Yes| G((Production))
  F -->|No| D`,
  },
  {
    title: 'System Architecture',
    category: 'Flowchart',
    description: 'A microservices architecture with multiple services and data stores.',
    source: `graph LR
  subgraph clients [Client Layer]
    A([Web App]) --> B[API Gateway]
    C([Mobile App]) --> B
  end
  subgraph services [Service Layer]
    B --> D[Auth Service]
    B --> E[User Service]
    B --> F[Order Service]
  end
  subgraph data [Data Layer]
    D --> G[(Auth DB)]
    E --> H[(User DB)]
    F --> I[(Order DB)]
    F --> J([Message Queue])
  end`,
  },
  {
    title: 'Decision Tree',
    category: 'Flowchart',
    description: 'A branching decision flowchart with multiple outcomes.',
    source: `graph TD
  A{Is it raining?} -->|Yes| B{Have umbrella?}
  A -->|No| C([Go outside])
  B -->|Yes| D([Go with umbrella])
  B -->|No| E{Is it heavy?}
  E -->|Yes| F([Stay inside])
  E -->|No| G([Run for it])`,
  },
  {
    title: 'Git Branching Workflow',
    category: 'Flowchart',
    description: 'A git flow showing feature branches, PRs, and release cycle.',
    source: `graph LR
  A[main] --> B[develop]
  B --> C[feature/auth]
  B --> D[feature/ui]
  C --> E{PR Review}
  D --> E
  E -->|approved| B
  B --> F[release/1.0]
  F --> G{Tests?}
  G -->|pass| A
  G -->|fail| F`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  STATE DIAGRAMS
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Basic State Diagram',
    category: 'State',
    description: 'A simple `stateDiagram-v2` with start/end pseudostates and transitions.',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Active : start
  Active --> Idle : cancel
  Active --> Done : complete
  Done --> [*]`,
  },
  {
    title: 'State: Composite States',
    category: 'State',
    description: 'Nested composite states with inner transitions.',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Processing : submit
  state Processing {
    parse --> validate
    validate --> execute
  }
  Processing --> Complete : done
  Processing --> Error : fail
  Error --> Idle : retry
  Complete --> [*]`,
  },
  {
    title: 'State: Connection Lifecycle',
    category: 'State',
    description: 'TCP-like connection state machine with multiple states.',
    source: `stateDiagram-v2
  [*] --> Closed
  Closed --> Connecting : connect
  Connecting --> Connected : success
  Connecting --> Closed : timeout
  Connected --> Disconnecting : close
  Connected --> Reconnecting : error
  Reconnecting --> Connected : success
  Reconnecting --> Closed : max_retries
  Disconnecting --> Closed : done
  Closed --> [*]`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Core Features
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: Basic Messages',
    category: 'Sequence',
    description: 'Simple request/response between two participants.',
    source: `sequenceDiagram
  Alice->>Bob: Hello Bob!
  Bob-->>Alice: Hi Alice!`,
  },
  {
    title: 'Sequence: Participant Aliases',
    category: 'Sequence',
    description: 'Using `participant ... as ...` for compact diagram IDs with readable labels.',
    source: `sequenceDiagram
  participant A as Alice
  participant B as Bob
  participant C as Charlie
  A->>B: Hello
  B->>C: Forward
  C-->>A: Reply`,
  },
  {
    title: 'Sequence: Actor Stick Figures',
    category: 'Sequence',
    description: 'Using `actor` instead of `participant` renders stick figures instead of boxes.',
    source: `sequenceDiagram
  actor U as User
  participant S as System
  participant DB as Database
  U->>S: Click button
  S->>DB: Query
  DB-->>S: Results
  S-->>U: Display`,
  },
  {
    title: 'Sequence: Arrow Types',
    category: 'Sequence',
    description: 'All arrow types: solid `->>` and dashed `-->>` with filled arrowheads, open arrows `-)` .',
    source: `sequenceDiagram
  A->>B: Solid arrow (sync)
  B-->>A: Dashed arrow (return)
  A-)B: Open arrow (async)
  B--)A: Open dashed arrow`,
  },
  {
    title: 'Sequence: Activation Boxes',
    category: 'Sequence',
    description: 'Using `+` and `-` to show when participants are active.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>+S: Request
  S->>+S: Process
  S->>-S: Done
  S-->>-C: Response`,
  },
  {
    title: 'Sequence: Self-Messages',
    category: 'Sequence',
    description: 'A participant sending a message to itself (displayed as a loop arrow).',
    source: `sequenceDiagram
  participant S as Server
  S->>S: Internal process
  S->>S: Validate
  S-->>S: Log`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Blocks
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: Loop Block',
    category: 'Sequence',
    description: 'A `loop` construct wrapping repeated message exchanges.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Connect
  loop Every 30s
    C->>S: Heartbeat
    S-->>C: Ack
  end
  C->>S: Disconnect`,
  },
  {
    title: 'Sequence: Alt/Else Block',
    category: 'Sequence',
    description: 'Conditional branching with `alt` (if) and `else` blocks.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  C->>S: Login
  alt Valid credentials
    S-->>C: 200 OK
  else Invalid
    S-->>C: 401 Unauthorized
  else Account locked
    S-->>C: 403 Forbidden
  end`,
  },
  {
    title: 'Sequence: Opt Block',
    category: 'Sequence',
    description: 'Optional block — executes only if condition is met.',
    source: `sequenceDiagram
  participant A as App
  participant C as Cache
  participant DB as Database
  A->>C: Get data
  C-->>A: Cache miss
  opt Cache miss
    A->>DB: Query
    DB-->>A: Results
    A->>C: Store in cache
  end`,
  },
  {
    title: 'Sequence: Par Block',
    category: 'Sequence',
    description: 'Parallel execution with `par`/`and` constructs.',
    source: `sequenceDiagram
  participant C as Client
  participant A as AuthService
  participant U as UserService
  participant O as OrderService
  C->>A: Authenticate
  par Fetch user data
    A->>U: Get profile
  and Fetch orders
    A->>O: Get orders
  end
  A-->>C: Combined response`,
  },
  {
    title: 'Sequence: Critical Block',
    category: 'Sequence',
    description: 'Critical section that must complete atomically.',
    source: `sequenceDiagram
  participant A as App
  participant DB as Database
  A->>DB: BEGIN
  critical Transaction
    A->>DB: UPDATE accounts
    A->>DB: INSERT log
  end
  A->>DB: COMMIT`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Notes
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: Notes (Right/Left/Over)',
    category: 'Sequence',
    description: 'Notes positioned to the right, left, or over participants.',
    source: `sequenceDiagram
  participant A as Alice
  participant B as Bob
  Note left of A: Alice prepares
  A->>B: Hello
  Note right of B: Bob thinks
  B-->>A: Reply
  Note over A,B: Conversation complete`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SEQUENCE DIAGRAMS — Complex / Real-World
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Sequence: OAuth 2.0 Flow',
    category: 'Sequence',
    description: 'Full OAuth 2.0 authorization code flow with token exchange.',
    source: `sequenceDiagram
  actor U as User
  participant App as Client App
  participant Auth as Auth Server
  participant API as Resource API
  U->>App: Click Login
  App->>Auth: Authorization request
  Auth->>U: Login page
  U->>Auth: Credentials
  Auth-->>App: Authorization code
  App->>Auth: Exchange code for token
  Auth-->>App: Access token
  App->>API: Request + token
  API-->>App: Protected resource
  App-->>U: Display data`,
  },
  {
    title: 'Sequence: Database Transaction',
    category: 'Sequence',
    description: 'Multi-step database transaction with rollback handling.',
    source: `sequenceDiagram
  participant C as Client
  participant S as Server
  participant DB as Database
  C->>S: POST /transfer
  S->>DB: BEGIN
  S->>DB: Debit account A
  alt Success
    S->>DB: Credit account B
    S->>DB: INSERT audit_log
    S->>DB: COMMIT
    S-->>C: 200 OK
  else Insufficient funds
    S->>DB: ROLLBACK
    S-->>C: 400 Bad Request
  end`,
  },
  {
    title: 'Sequence: Microservice Orchestration',
    category: 'Sequence',
    description: 'Complex multi-service flow with parallel calls and error handling.',
    source: `sequenceDiagram
  participant G as Gateway
  participant A as Auth
  participant U as Users
  participant O as Orders
  participant N as Notify
  G->>A: Validate token
  A-->>G: Valid
  par Fetch data
    G->>U: Get user
    U-->>G: User data
  and
    G->>O: Get orders
    O-->>G: Order list
  end
  G->>N: Send notification
  N-->>G: Queued
  Note over G: Aggregate response`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ANIMATION — Entrance animations (CSS + SMIL)
  // ══════════════════════════════════════════════════════════════════════════

  {
    title: 'Default Animation',
    category: 'Animation',
    description: 'Cascade entrance: nodes fade in rank-by-rank, edges draw between them.',
    source: `graph TD
  A[Request] --> B{Cache Hit?}
  B -->|Yes| C[Return Cached]
  B -->|No| D[Fetch Origin]
  D --> E[Store in Cache]
  E --> C
  C --> F[Response]`,
    options: { animate: true },
  },
  {
    title: 'Animation: Fade-Up Entrance',
    category: 'Animation',
    description: 'Nodes slide up as they appear. Subgraph containers animate with group delay.',
    source: `graph TD
  subgraph Frontend
    A[React App] --> B[State Manager]
  end
  subgraph Backend
    C[API Server] --> D[Database]
  end
  B --> C`,
    options: { animate: { nodeAnimation: 'fade-up' } },
  },
  {
    title: 'Animation: Scale Entrance',
    category: 'Animation',
    description: 'Nodes scale up from center. Works well with state diagrams.',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading : fetch
  Loading --> Success : resolve
  Loading --> Error : reject
  Error --> Idle : retry
  Success --> [*]`,
    options: { animate: { nodeAnimation: 'scale', duration: 800 } },
  },
  {
    title: 'Animation: Custom Timing',
    category: 'Animation',
    description: 'Fast stagger with high overlap — nodes appear almost immediately after their edge starts drawing.',
    source: `graph LR
  A[Input] --> B[Validate] --> C[Transform] --> D[Enrich] --> E[Store] --> F[Notify] --> G[Done]`,
    options: { animate: { stagger: 60, nodeOverlap: 0.5, duration: 500 } },
  },
]
