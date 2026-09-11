// AGENT-001 (ADR-011): GitHub's actions — same shape and same reasoning as
// server/connectors/community/gitlab/actions.js (registered alongside, not
// instead of, routes.js's legacy REST routes; handlers call the exact same
// client.js functions `POST /:id/test` and `POST /:id/sync` already use, so
// there is exactly one implementation of GitHub status/sync, not two).
const { createGithubRepository, githubRequest, syncGithub } = require("./client");

const EMPTY_INPUT_SCHEMA = { type: "object", additionalProperties: false };

const STATUS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "latency"],
  properties: {
    status: { type: "string" },
    latency: { type: "string" },
    user: { type: ["string", "null"] },
  },
};

const SYNC_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projectCount", "deploymentCount", "commitCount", "syncedAt"],
  properties: {
    projectCount: { type: "integer", minimum: 0 },
    deploymentCount: { type: "integer", minimum: 0 },
    commitCount: { type: "integer", minimum: 0 },
    syncedAt: { type: "string" },
  },
};

const CREATE_REPOSITORY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // "private" is required rather than defaulted: a caller that forgets the flag
  // must get a validation error, never a public repository.
  required: ["name", "private"],
  properties: {
    name: { type: "string", minLength: 1 },
    private: { type: "boolean" },
    description: { type: "string" },
    org: { type: "string", description: "Create under this organization instead of the token's own account." },
    autoInit: { type: "boolean", description: "Let GitHub write an initial commit. Leave false to push existing history." },
  },
};

const CREATE_REPOSITORY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fullName", "private", "cloneUrl"],
  properties: {
    id: { type: ["integer", "null"] },
    name: { type: "string" },
    fullName: { type: ["string", "null"] },
    private: { type: "boolean" },
    webUrl: { type: ["string", "null"] },
    cloneUrl: { type: ["string", "null"] },
    sshUrl: { type: ["string", "null"] },
    defaultBranch: { type: ["string", "null"] },
  },
};

const APPROVE_PULL_REQUEST_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["project", "number"],
  properties: {
    project: { type: "string", minLength: 1, description: "Repository as owner/name." },
    number: { type: "integer", minimum: 1 },
    body: { type: "string", description: "Optional comment to submit with the approval." },
  },
};

const APPROVE_PULL_REQUEST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["state"],
  properties: {
    id: { type: ["integer", "null"] },
    state: { type: "string" },
    reviewer: { type: ["string", "null"] },
    submittedAt: { type: ["string", "null"] },
    webUrl: { type: ["string", "null"] },
  },
};

const UPDATE_PULL_REQUEST_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["project", "number"],
  // Se exige al menos uno de los dos campos editables: una llamada que no trae
  // ninguno no es "no cambiar nada", es una peticion mal armada, y aceptarla
  // dejaria una escritura en el log de actividad que no escribio nada.
  anyOf: [{ required: ["title"] }, { required: ["body"] }],
  properties: {
    project: { type: "string", minLength: 1, description: "Repository as owner/name." },
    number: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1 },
    body: { type: "string", description: "Full replacement description, not an append." },
  },
};

const UPDATE_PULL_REQUEST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["number", "title"],
  properties: {
    number: { type: "integer" },
    title: { type: "string" },
    state: { type: ["string", "null"] },
    webUrl: { type: ["string", "null"] },
    updatedAt: { type: ["string", "null"] },
  },
};

const CREATE_PULL_REQUEST_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["project", "title", "head", "base"],
  properties: {
    project: { type: "string", minLength: 1, description: "Repository as owner/name." },
    title: { type: "string", minLength: 1 },
    // head y base van explicitos y sin valor por defecto. Adivinar la rama
    // destino ("seguro que es main") es como se abre un pull request contra la
    // rama equivocada, y eso se descubre cuando alguien ya lo reviso.
    head: { type: "string", minLength: 1, description: "Branch the changes are on." },
    base: { type: "string", minLength: 1, description: "Branch they should be merged into." },
    body: { type: "string" },
    draft: { type: "boolean" },
  },
};

const CREATE_PULL_REQUEST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["number", "title"],
  properties: {
    number: { type: "integer" },
    title: { type: "string" },
    state: { type: ["string", "null"] },
    draft: { type: "boolean" },
    head: { type: ["string", "null"] },
    base: { type: ["string", "null"] },
    webUrl: { type: ["string", "null"] },
    createdAt: { type: ["string", "null"] },
  },
};

function registerGithubActions({
  registry,
  request = githubRequest,
  sync = syncGithub,
  createRepository = createGithubRepository,
  now = Date.now,
  isoNow = () => new Date().toISOString(),
}) {
  registry.registerAction({
    id: "status",
    connectorTypeId: "github",
    title: "Check connection status",
    effect: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: STATUS_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const startedAt = now();
      const user = await request(cfg.baseUrl, cfg.token, "/user");
      const latency = `${Math.max(0, now() - startedAt)}ms`;
      return { status: "ok", latency, user: user?.login || null };
    },
  });

  registry.registerAction({
    id: "sync",
    connectorTypeId: "github",
    title: "Sync repos, deployments, and commits",
    effect: "write",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: SYNC_OUTPUT_SCHEMA,
    handler: async ({ services }) => {
      const cfg = services.store.getConfig();
      const { projects, deployments, commits, pullRequests } = await sync(cfg, { request });
      const syncedAt = isoNow();
      services.store.setData({ projects, deployments, commits, pullRequests: pullRequests || [], syncedAt });
      services.store.setStatus({
        status: "ok",
        lastSync: syncedAt,
        lastError: null,
        itemsSynced: projects.length + deployments.length + commits.length,
      });
      return {
        projectCount: projects.length,
        deploymentCount: deployments.length,
        commitCount: commits.length,
        syncedAt,
      };
    },
  });

  // Aprobar es una escritura al proveedor y queda en el registro como tal, con
  // sus esquemas — no una llamada suelta desde una ruta. No es "destructive":
  // no borra nada y una aprobación se puede retirar desde GitHub, asi que no
  // pasa por el Approval Center.
  //
  // GitHub rechaza con 422 que alguien apruebe su propio pull request. No se
  // adivina aqui quien es el autor — haria falta una llamada extra por cada
  // apertura del detalle —; se deja hablar al proveedor y su mensaje llega tal
  // cual a quien pulso el boton.
  registry.registerAction({
    id: "approve-pull-request",
    connectorTypeId: "github",
    title: "Approve a pull request",
    effect: "write",
    inputSchema: APPROVE_PULL_REQUEST_INPUT_SCHEMA,
    outputSchema: APPROVE_PULL_REQUEST_OUTPUT_SCHEMA,
    handler: async ({ services, input }) => {
      const cfg = services.store.getConfig();
      const review = await request(
        cfg.baseUrl,
        cfg.token,
        `/repos/${input.project}/pulls/${input.number}/reviews`,
        "POST",
        { event: "APPROVE", ...(input.body ? { body: input.body } : {}) },
      );
      return {
        id: review?.id ?? null,
        state: review?.state || "APPROVED",
        reviewer: review?.user?.login || null,
        submittedAt: review?.submitted_at || null,
        webUrl: review?.html_url || null,
      };
    },
  });

  // Abrir un pull request. Con update-pull-request y approve-pull-request ya
  // registradas, esto cierra el ciclo: Lintaya puede abrir, corregir y aprobar
  // sin salir a la herramienta del proveedor, y las tres quedan en el log con
  // el X-Actor de quien las pidio.
  registry.registerAction({
    id: "create-pull-request",
    connectorTypeId: "github",
    title: "Open a pull request",
    effect: "write",
    inputSchema: CREATE_PULL_REQUEST_INPUT_SCHEMA,
    outputSchema: CREATE_PULL_REQUEST_OUTPUT_SCHEMA,
    handler: async ({ services, input }) => {
      const cfg = services.store.getConfig();
      const created = await request(
        cfg.baseUrl,
        cfg.token,
        `/repos/${input.project}/pulls`,
        "POST",
        {
          title: input.title,
          head: input.head,
          base: input.base,
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        },
      );
      return {
        number: created?.number ?? 0,
        title: created?.title ?? input.title,
        state: created?.state || null,
        draft: !!created?.draft,
        head: created?.head?.ref || input.head,
        base: created?.base?.ref || input.base,
        webUrl: created?.html_url || null,
        createdAt: created?.created_at || null,
      };
    },
  });

  // Editar titulo y descripcion de un pull request. Es escritura y va por el
  // registro como todas: asi queda en Logs -> Connectors/Activity con el
  // X-Actor de quien la pidio, que es como el proyecto distingue lo que hizo un
  // agente de lo que hizo el usuario.
  //
  // body reemplaza la descripcion entera, no la amplia: GitHub no tiene "anadir
  // al final" y fingir que si lo tiene invitaria a perder texto sin avisar.
  registry.registerAction({
    id: "update-pull-request",
    connectorTypeId: "github",
    title: "Edit a pull request's title or description",
    effect: "write",
    inputSchema: UPDATE_PULL_REQUEST_INPUT_SCHEMA,
    outputSchema: UPDATE_PULL_REQUEST_OUTPUT_SCHEMA,
    handler: async ({ services, input }) => {
      const cfg = services.store.getConfig();
      const updated = await request(
        cfg.baseUrl,
        cfg.token,
        `/repos/${input.project}/pulls/${input.number}`,
        "PATCH",
        {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        },
      );
      return {
        number: updated?.number ?? input.number,
        title: updated?.title ?? input.title ?? "",
        state: updated?.state || null,
        webUrl: updated?.html_url || null,
        updatedAt: updated?.updated_at || null,
      };
    },
  });

  registry.registerAction({
    id: "create-repository",
    connectorTypeId: "github",
    title: "Create a repository",
    effect: "write",
    inputSchema: CREATE_REPOSITORY_INPUT_SCHEMA,
    outputSchema: CREATE_REPOSITORY_OUTPUT_SCHEMA,
    handler: async ({ services, input }) => {
      const cfg = services.store.getConfig();
      return createRepository(cfg, input, { request });
    },
  });
}

module.exports = { registerGithubActions };
