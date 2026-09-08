// OpenAPI 3.0 spec generator for Lintaya
function generateOpenAPISpec({ connectors = [] } = {}) {
  const paths = {
    // Health
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Liveness check",
        description: "Returns server status. No authentication required.",
        security: [],
        responses: {
          "200": {
            description: "Server is alive",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" }, ts: { type: "number" } } }
              }
            }
          }
        }
      }
    },

    // AI Context
    "/api/ai-context": {
      get: {
        tags: ["AI Context"],
        summary: "Get AI agent context",
        description: "Returns safe ConnectorType discovery metadata and public route hints. No stored context, configuration, status, or secrets are returned.",
        security: [],
        responses: {
          "200": {
            description: "AI context with endpoints and connectors",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PublicAIContext" } } }
          }
        }
      },
      put: {
        tags: ["AI Context"],
        summary: "Update AI context",
        description: "Update stored AI context (editable by user)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } }
        },
        responses: {
          "200": { description: "Context updated" }
        }
      }
    },

    "/api/ai-context/stored": {
      get: {
        tags: ["AI Context"],
        summary: "Get stored AI context",
        description: "Returns only the user-stored AI context",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Stored context",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    },

    "/api/openapi.json": {
      get: {
        tags: ["AI Context"],
        summary: "Get the Lintaya HTTP contract",
        description: "Public OpenAPI reference. Describing a route never grants permission to call it.",
        security: [],
        responses: {
          "200": {
            description: "OpenAPI 3.0 document",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },

    "/llms.txt": {
      get: {
        tags: ["AI Context"],
        summary: "Get English repository orientation",
        description: "Public static index containing repository documentation links and safety boundaries only.",
        security: [],
        responses: { "200": { description: "English agent index", content: { "text/plain": { schema: { type: "string" } } } } },
      },
    },

    "/llms.es.txt": {
      get: {
        tags: ["AI Context"],
        summary: "Get Spanish repository orientation",
        description: "Public static index containing repository documentation links and safety boundaries only.",
        security: [],
        responses: { "200": { description: "Spanish agent index", content: { "text/plain": { schema: { type: "string" } } } } },
      },
    },

    // Connectors
    "/api/connectors": {
      get: {
        tags: ["Connectors"],
        summary: "List all connectors",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "List of connectors",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      },
      post: {
        tags: ["Connectors"],
        summary: "Create connector",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } }
        },
        responses: {
          "200": { description: "Connector created" }
        }
      }
    },

    "/api/connectors/status": {
      get: {
        tags: ["Connectors"],
        summary: "Get all connector statuses",
        description: "Aggregated live status for every connector type in one call (config presence, last sync, item counts, activity log).",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Connector statuses",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    },

    "/api/connectors/catalog": {
      get: {
        tags: ["Connectors"],
        summary: "List connector types available to configure",
        description: "Catalog generated from connector manifests and safe summaries of config schemas. It never includes stored configuration, secret values, implementation paths, or filesystem locations.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Available connector types, ordered by display name",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ConnectorCatalogEntry" },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },

    "/api/connectors/modules": {
      get: {
        tags: ["Connectors"],
        summary: "List active connector-owned modules",
        description: "Navigation metadata for full views declared by manifests and enabled only for configured connector instances. It contains no configuration or secret values.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Configured connector modules ordered for navigation",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ConnectorModule" } } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },

    "/api/backups/export": {
      post: {
        tags: ["Backups"],
        summary: "Export an encrypted Lintaya backup",
        description: "Creates an encrypted logical backup of the main database and repository settings. The passphrase is used only for this request and is never stored.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/BackupPassword" } } },
        },
        responses: {
          "200": { description: "Encrypted .lhq archive", content: { "application/vnd.lintaya.backup+json": { schema: { type: "string", format: "binary" } } } },
          "422": { description: "Passphrase does not meet requirements", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } } },
        },
      },
    },

    "/api/backups/import": {
      post: {
        tags: ["Backups"],
        summary: "Restore an encrypted Lintaya backup",
        description: "Validates and restores an encrypted .lhq archive. It saves an encrypted local recovery point before replacing data, locks Vault, and requires a server restart for restored connector configuration to take effect.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "X-Lintaya-Backup-Password", in: "header", required: true, schema: { type: "string", format: "password" }, description: "Archive passphrase; never persisted." },
          { name: "X-Lintaya-Backup-Confirm", in: "header", required: true, schema: { type: "string", enum: ["RESTORE"] }, description: "Explicit destructive-operation confirmation." },
        ],
        requestBody: {
          required: true,
          content: { "application/vnd.lintaya.backup+json": { schema: { type: "string", format: "binary" } } },
        },
        responses: {
          "200": { description: "Backup restored; restart required", content: { "application/json": { schema: { $ref: "#/components/schemas/BackupRestoreResult" } } } },
          "400": { description: "Missing confirmation or file", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } } },
          "422": { description: "Bad passphrase, modified file, or invalid backup", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } } },
        },
      },
    },

    "/api/connectors/{id}/config-schema": {
      get: {
        tags: ["Connectors"],
        summary: "Get a connector's config JSON Schema",
        description: "The connector's config.schema.json, used to render its config form. Secret fields are marked x-lintaya-secret rather than filled in.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "JSON Schema for this connector's config" },
          "404": { description: "Connector type has no config schema" }
        }
      }
    },

    "/api/connectors/{typeId}/instances": {
      post: {
        tags: ["Connectors"],
        summary: "Add another connection of the same type",
        description: "Creates an N-th instance of an instantiable connector type (the 8 simple types: gitlab, github, bitbucket, outline, portainer, qportal, outlook, plane). \"+ Add another connection\" in the UI.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "typeId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { label: { type: "string" } } } } }
        },
        responses: {
          "200": { description: "Instance created" },
          "400": { description: "Connector type is not instantiable" },
          "404": { description: "Unknown connector type" }
        }
      }
    },

    "/api/connectors/{typeId}/instances/{instanceId}": {
      delete: {
        tags: ["Connectors"],
        summary: "Remove an extra connection",
        description: "Removes an extra instance (not the base connector). Its routes stay mounted but its config is cleared, so it answers connector-not-configured instead of serving stale data.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "typeId", in: "path", required: true, schema: { type: "string" } },
          { name: "instanceId", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": { description: "Removed" },
          "400": { description: "Cannot remove the base instance" }
        }
      }
    },

    "/api/connectors/{id}": {
      put: {
        tags: ["Connectors"],
        summary: "Update connector",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated" } }
      },
      delete: {
        tags: ["Connectors"],
        summary: "Delete connector",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted" } }
      }
    },

    "/api/connectors/{id}/sync": {
      post: {
        tags: ["Connectors"],
        summary: "Trigger sync for connector",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Sync triggered" } }
      }
    },

    "/api/connectors/{id}/ai-context": {
      get: {
        tags: ["Connectors"],
        summary: "Get AI context for connector",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "AI context",
            content: { "application/json": { schema: { type: "object", properties: { content: { type: "string" } } } } }
          }
        }
      },
      post: {
        tags: ["Connectors"],
        summary: "Update AI context for connector",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { content: { type: "string" } } } } }
        },
        responses: { "200": { description: "Updated" } }
      }
    },

    "/api/connectors/{id}/sync-interval": {
      post: {
        tags: ["Connectors"],
        summary: "Update sync interval",
        description: "Sets a per-connector auto-sync override, in minutes (1-1440). Omit or send null to fall back to the default fast/slow group interval.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { minutes: { type: "number", nullable: true, minimum: 1, maximum: 1440 } } } } }
        },
        responses: { "200": { description: "Updated" } }
      }
    },

    // Repos & git workspace — most repo/git operations are mounted under the
    // owning connector's namespace (see /api/connectors/{provider}/projects/{id}/git/...
    // below), not under a generic /api/repos. The handful of routes actually
    // under /api/repos are specific to one hardcoded repo, not a general CRUD surface.
    "/api/repos/network-tools/status": {
      get: {
        tags: ["Repos"],
        summary: "Get the network-tools sandbox status",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Sandbox status" } }
      }
    },

    "/api/repos/network-tools/play": {
      post: {
        tags: ["Repos"],
        summary: "Start the network-tools sandbox",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Started" } }
      }
    },

    "/api/repos/network-tools/stop": {
      post: {
        tags: ["Repos"],
        summary: "Stop the network-tools sandbox",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Stopped" } }
      }
    },

    "/api/connectors/{provider}/projects/{id}/git/status": {
      get: {
        tags: ["Repos"],
        summary: "Working copy status (staged/unstaged/untracked)",
        description: "Git operations for a cloned project live under its owning connector (gitlab, github, bitbucket, ...), keyed by :provider — not under /api/repos.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "provider", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "File status" } }
      }
    },

    "/api/connectors/{provider}/projects/{id}/git/log": {
      get: {
        tags: ["Repos"],
        summary: "Commit log",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "provider", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "Commit history" } }
      }
    },

    "/api/connectors/{provider}/projects/{id}/git/pull": {
      post: {
        tags: ["Repos"],
        summary: "Pull latest from remote",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "provider", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "Pulled" } }
      }
    },

    "/api/connectors/{provider}/projects/{id}/tree": {
      get: {
        tags: ["Repos"],
        summary: "Browse the repo file tree",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "provider", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "File tree" } }
      }
    },

    // VMs
    "/api/vms": {
      get: {
        tags: ["VMs"],
        summary: "List all VMs",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "List of VMs",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      }
    },

    "/api/vms-live": {
      get: {
        tags: ["VMs"],
        summary: "Live VM data from vCenter",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Live VM data",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      }
    },

    "/api/hosts-live": {
      get: {
        tags: ["VMs"],
        summary: "Live host data",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Host data",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      }
    },

    // SSH
    "/api/ssh/session": {
      post: {
        tags: ["SSH"],
        summary: "Create SSH session",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  host: { type: "string" },
                  port: { type: "number" },
                  username: { type: "string" },
                  password: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Session created" } }
      }
    },

    "/api/ssh/logs": {
      get: {
        tags: ["SSH"],
        summary: "List SSH logs",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "List of SSH logs",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      }
    },

    // Vault
    "/api/vault/status": {
      get: {
        tags: ["Vault"],
        summary: "Get vault status",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Vault status",
            content: { "application/json": { schema: { type: "object", properties: { locked: { type: "boolean" } } } } }
          }
        }
      }
    },

    "/api/vault/items": {
      get: {
        tags: ["Vault"],
        summary: "List vault items",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "List of vault items",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      }
    },

    "/api/vault/unlock": {
      post: {
        tags: ["Vault"],
        summary: "Unlock vault",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { password: { type: "string" } } } } }
        },
        responses: { "200": { description: "Vault unlocked" } }
      }
    },

    "/api/vault/lock": {
      post: {
        tags: ["Vault"],
        summary: "Lock vault",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Vault locked" } }
      }
    },

    // Settings
    "/api/settings/{key}": {
      put: {
        tags: ["Settings"],
        summary: "Update setting",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } }
        },
        responses: { "200": { description: "Setting updated" } }
      }
    },

    "/api/settings/auto-sync": {
      get: {
        tags: ["Settings"],
        summary: "Get auto-sync config",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Auto-sync config",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      },
      post: {
        tags: ["Settings"],
        summary: "Update auto-sync config",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } }
        },
        responses: { "200": { description: "Updated" } }
      }
    },

    "/api/settings/ai": {
      get: {
        tags: ["Settings"],
        summary: "Get AI assistant provider state (safe subset, no secrets)",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Provider state + presets",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      },
      post: {
        tags: ["Settings"],
        summary: "Save AI provider config",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } }
        },
        responses: { "200": { description: "Updated provider state" } }
      },
      delete: {
        tags: ["Settings"],
        summary: "Clear AI provider config",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Provider state reset" } }
      }
    },

    "/api/settings/ai/models": {
      post: {
        tags: ["Settings"],
        summary: "List models available from a provider's server (Ollama, LM Studio, LiteLLM proxy, ...)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { "application/json": {
            schema: {
              type: "object",
              properties: {
                provider: { type: "string" },
                baseUrl: { type: "string" },
                apiKey: { type: "string" }
              },
              required: ["provider"]
            }
          } }
        },
        responses: { "200": { description: "Model id list" } }
      }
    },

    "/api/chat": {
      post: {
        tags: ["Settings"],
        summary: "Stream an AI assistant answer (SSE)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: { "application/json": {
            schema: {
              type: "object",
              properties: {
                messages: { type: "array", items: { type: "object" } },
                system: { type: "string" },
                model: { type: "string" }
              }
            }
          } }
        },
        responses: { "200": { description: "Server-sent event stream" } }
      }
    },

    // Containers
    "/api/containers": {
      get: {
        tags: ["Containers"],
        summary: "List all containers",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "List of containers",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      }
    },

    "/api/containers/hosts": {
      get: {
        tags: ["Containers"],
        summary: "List container hosts",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "List of hosts",
            content: { "application/json": { schema: { type: "array", items: { type: "object" } } } }
          }
        }
      }
    },

    // Activity
    "/api/activity/status": {
      get: {
        tags: ["Activity"],
        summary: "Get activity status",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Activity status",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    },

    // Snapshot
    "/api/snapshot": {
      get: {
        tags: ["System"],
        summary: "Get full system snapshot",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Full system snapshot",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    }
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "Lintaya API",
      description: "PWA platform for Git project management and analysis with operational modules, Docker containers, a Bitwarden vault, apps, Plane, Outlook and an SSH console.",
      version: "1.0.0",
      contact: {
        name: "Lintaya",
        url: "https://github.com/Ender618X/personalhq"
      }
    },
    servers: [{ url: "/", description: "Current Lintaya origin" }],
    components: {
      schemas: {
        PublicAIContext: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description", "auth", "endpoints", "connectors", "tips", "generatedAt", "visibility"],
          properties: {
            name: { type: "string", example: "Lintaya" },
            description: { type: "string" },
            auth: { $ref: "#/components/schemas/PublicAuthHint" },
            endpoints: { $ref: "#/components/schemas/PublicEndpointHints" },
            connectors: { type: "array", items: { $ref: "#/components/schemas/ConnectorTypeDiscovery" } },
            tips: { type: "array", items: { type: "string" } },
            generatedAt: { type: "string", format: "date-time" },
            visibility: { type: "string", enum: ["public-discovery"] },
          },
        },
        PublicAuthHint: {
          type: "object",
          additionalProperties: false,
          required: ["type", "header", "example", "note"],
          properties: {
            type: { type: "string", enum: ["Bearer token"] },
            header: { type: "string", enum: ["Authorization"] },
            example: { type: "string", enum: ["Authorization: Bearer <HQ_TOKEN>"] },
            note: { type: "string" },
          },
        },
        PublicEndpointHints: {
          type: "object",
          additionalProperties: false,
          required: ["health", "connectors"],
          properties: {
            health: { type: "array", items: { type: "string" } },
            connectors: { type: "array", items: { type: "string" } },
          },
        },
        ConnectorTypeDiscovery: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "capabilities"],
          properties: {
            id: { type: "string", example: "github" },
            name: { type: "string", example: "GitHub" },
            capabilities: { type: "array", items: { type: "string" } },
          },
        },
        BackupPassword: {
          type: "object",
          required: ["password"],
          properties: { password: { type: "string", format: "password", minLength: 12 } },
        },
        BackupRestoreResult: {
          type: "object",
          required: ["ok", "createdAt", "recoveryPoint", "vaultLocked", "restartRequired"],
          properties: {
            ok: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            recoveryPoint: { type: "string", example: "lintaya-before-import-2026-08-21T12-00-00-000Z.lhq" },
            vaultLocked: { type: "boolean" },
            restartRequired: { type: "boolean" },
          },
        },
        ConnectorCatalogEntry: {
          type: "object",
          required: ["id", "displayName", "tier", "lifecycle", "capabilities", "instantiable", "config"],
          properties: {
            id: { type: "string", example: "github" },
            displayName: { type: "string", example: "GitHub" },
            tier: { type: "string", enum: ["community", "enterprise", "development"] },
            lifecycle: { type: "string", enum: ["stable", "beta", "development", "deprecated"] },
            capabilities: { type: "array", items: { type: "string" }, example: ["repositories.read", "workflows.read"] },
            instantiable: { type: "boolean", description: "Whether the connector accepts extra named instances." },
            config: { allOf: [{ $ref: "#/components/schemas/ConnectorCatalogConfig" }], nullable: true },
          },
        },
        ConnectorCatalogConfig: {
          type: "object",
          required: ["title", "description", "fields"],
          properties: {
            title: { type: "string", example: "GitHub connector configuration" },
            description: { type: "string", description: "Description declared by the config schema; never a stored value." },
            fields: {
              type: "array",
              items: { $ref: "#/components/schemas/ConnectorCatalogField" },
            },
          },
        },
        ConnectorCatalogField: {
          type: "object",
          required: ["id", "label", "required", "secret"],
          properties: {
            id: { type: "string", example: "token" },
            label: { type: "string", example: "Token" },
            required: { type: "boolean" },
            secret: { type: "boolean", description: "Only identifies an input as sensitive; no secret value is returned." },
          },
        },
        ConnectorModule: {
          type: "object",
          required: ["route", "connectorId", "connectorType", "moduleId", "label", "icon", "component", "navOrder"],
          properties: {
            route: { type: "string", example: "module:github:repositories" },
            connectorId: { type: "string", example: "github" },
            connectorType: { type: "string", example: "github" },
            moduleId: { type: "string", example: "repositories" },
            label: { type: "string", example: "Repos GitHub" },
            icon: { type: "string", example: "repos" },
            component: { type: "string", example: "ReposView", description: "Name of a component already loaded by the PWA; never executable code." },
            navOrder: { type: "integer", example: 91 },
          },
        },
        ProblemDetails: {
          type: "object",
          description: "RFC 9457 Problem Details with Lintaya extensions (code, details, requestId).",
          required: ["type", "title", "status", "detail", "instance", "code", "requestId"],
          properties: {
            type: { type: "string", format: "uri", example: "urn:lintaya:problem:bad-request" },
            title: { type: "string", example: "Bad Request" },
            status: { type: "integer", example: 400 },
            detail: { type: "string", example: "name and kind are required" },
            instance: { type: "string", format: "uri", example: "urn:lintaya:request:0f4f1e31-9e49-4b67-8f82-a22dbefe9e0d" },
            code: { type: "string", example: "BAD_REQUEST" },
            details: { nullable: true, description: "Safe validation details only; never secrets or stack traces." },
            requestId: { type: "string", format: "uuid" },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: "Missing or invalid Bearer token.",
          content: { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "HQ_TOKEN",
          description: "Opaque Lintaya token configured by the operator. Never place it in prompts, URLs, or logs."
        }
      }
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Health", description: "Health checks (no auth)" },
      { name: "AI Context", description: "AI agent discovery endpoint" },
      { name: "Connectors", description: "Integration connectors (vCenter, GitHub, GitLab, etc.)" },
      { name: "Repos", description: "Repository management" },
      { name: "VMs", description: "Virtual machine management" },
      { name: "SSH", description: "SSH sessions and logs" },
      { name: "Vault", description: "Bitwarden vault integration" },
      { name: "Backups", description: "Encrypted export and restore of Lintaya data" },
      { name: "Settings", description: "Application settings" },
      { name: "Containers", description: "Docker container management" },
      { name: "Activity", description: "Activity logging" },
      { name: "System", description: "System information" }
    ],
    paths
  };
}

module.exports = { generateOpenAPISpec };
