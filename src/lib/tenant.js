// Defense in depth: RLS enforces membership and the request's workspace; queries
// also carry an explicit workspace filter. Caller fields cannot change tenancy.
export function tenantTable(client, table, workspaceId) {
  if (!workspaceId) throw new Error('Choose a workspace before reading or changing CRM data.')
  const scoped = (fields) => {
    if (Array.isArray(fields)) return fields.map(scoped)
    if (fields?.workspace_id && fields.workspace_id !== workspaceId) throw new Error('A record cannot be moved between workspaces.')
    return { ...fields, workspace_id: workspaceId }
  }
  return {
    select: (...args) => client.from(table).select(...args).eq('workspace_id', workspaceId),
    insert: (rows, options) => client.from(table).insert(scoped(rows), options),
    upsert: (rows, options = {}) => client.from(table).upsert(scoped(rows), {
      ...options, onConflict: `workspace_id,${options.onConflict || 'id'}`,
    }),
    update: (fields, options) => {
      if (Object.hasOwn(fields, 'workspace_id')) throw new Error('A record cannot be moved between workspaces.')
      return client.from(table).update(fields, options).eq('workspace_id', workspaceId)
    },
    delete: (...args) => client.from(table).delete(...args).eq('workspace_id', workspaceId),
  }
}
