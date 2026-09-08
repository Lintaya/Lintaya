const assert = require("node:assert/strict");
const test = require("node:test");

const { generateOpenAPISpec } = require("./openapi");

test("OpenAPI publishes the RFC 9457 Problem Details schema", () => {
  const schema = generateOpenAPISpec().components.schemas.ProblemDetails;
  assert.ok(schema);
  assert.deepEqual(schema.required, ["type", "title", "status", "detail", "instance", "code", "requestId"]);
  assert.equal(schema.properties.type.format, "uri");
  assert.equal(schema.properties.status.type, "integer");
  assert.equal(schema.properties.requestId.format, "uuid");
});

test("OpenAPI explicitly identifies every public agent-readable surface", () => {
  const spec = generateOpenAPISpec();
  for (const [path, method] of [
    ["/api/health", "get"],
    ["/api/ai-context", "get"],
    ["/api/openapi.json", "get"],
    ["/llms.txt", "get"],
    ["/llms.es.txt", "get"],
  ]) {
    assert.deepEqual(spec.paths[path][method].security, [], `${method.toUpperCase()} ${path} must be explicitly public`);
  }
  assert.deepEqual(spec.paths["/api/ai-context"].put.security, [{ bearerAuth: [] }]);
  assert.deepEqual(spec.paths["/api/ai-context/stored"].get.security, [{ bearerAuth: [] }]);
  assert.equal(spec.paths["/llms.txt"].get.responses["200"].content["text/plain"].schema.type, "string");
});

test("OpenAPI gives public AI context a closed schema and describes the token as opaque", () => {
  const spec = generateOpenAPISpec();
  const operationSchema = spec.paths["/api/ai-context"].get.responses["200"].content["application/json"].schema;
  assert.deepEqual(operationSchema, { $ref: "#/components/schemas/PublicAIContext" });
  assert.equal(spec.components.schemas.PublicAIContext.additionalProperties, false);
  assert.equal(spec.components.schemas.ConnectorTypeDiscovery.additionalProperties, false);
  assert.equal(spec.components.securitySchemes.bearerAuth.bearerFormat, "HQ_TOKEN");
  assert.doesNotMatch(spec.components.securitySchemes.bearerAuth.description, /start-dev|database|\.db|JWT/i);
  assert.deepEqual(spec.servers, [{ url: "/", description: "Current Lintaya origin" }]);
});

test("OpenAPI documents the authenticated, safe connector catalog", () => {
  const spec = generateOpenAPISpec();
  const operation = spec.paths["/api/connectors/catalog"].get;
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  assert.match(operation.description, /never includes stored configuration, secret values, implementation paths, or filesystem locations/i);
  assert.deepEqual(
    operation.responses["200"].content["application/json"].schema.items,
    { $ref: "#/components/schemas/ConnectorCatalogEntry" },
  );
  assert.equal(spec.components.schemas.ConnectorCatalogField.properties.secret.type, "boolean");
  assert.equal(spec.components.responses.Unauthorized.content["application/problem+json"].schema.$ref, "#/components/schemas/ProblemDetails");
});

test("OpenAPI documents configured connector modules without configuration values", () => {
  const spec = generateOpenAPISpec();
  const operation = spec.paths["/api/connectors/modules"].get;
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  assert.match(operation.description, /no configuration or secret values/i);
  assert.deepEqual(
    operation.responses["200"].content["application/json"].schema.items,
    { $ref: "#/components/schemas/ConnectorModule" },
  );
  assert.match(spec.components.schemas.ConnectorModule.properties.component.description, /never executable code/i);
});

test("OpenAPI documents encrypted backup export and explicit restore", () => {
  const spec = generateOpenAPISpec();
  assert.equal(spec.paths["/api/backups/export"].post.requestBody.content["application/json"].schema.$ref, "#/components/schemas/BackupPassword");
  const restore = spec.paths["/api/backups/import"].post;
  assert.equal(restore.parameters[1].name, "X-Lintaya-Backup-Confirm");
  assert.equal(restore.parameters[1].schema.enum[0], "RESTORE");
  assert.equal(spec.components.schemas.BackupPassword.properties.password.minLength, 12);
});
