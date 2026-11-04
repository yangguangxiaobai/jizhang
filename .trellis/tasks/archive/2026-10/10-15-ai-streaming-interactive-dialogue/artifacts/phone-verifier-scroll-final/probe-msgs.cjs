const D = require('/app/packages/server/node_modules/better-sqlite3');
const db = new D('/data/jizhang.db', { readonly: true });
const ids = ['f59a2d6e-7f10-48a1-ab2b-504995a2ed37','d76d9014-a6c8-4e61-a83c-5286d30e63e1','3642b8f8-674a-495f-af27-d61757a45bca','d13ee42b-ae56-40a1-af8b-800144ad6a02','17624436-c25f-4968-b363-d0c9635e0c27','45efb5e7-187f-46aa-8759-5a112086f830'];
const q = db.prepare(`SELECT conversation_id, role, length(content_json) len, created_at FROM assistant_messages WHERE conversation_id=? ORDER BY created_at ASC`);
const out = {};
for (const id of ids) out[id] = q.all(id);
console.log(JSON.stringify(out, null, 2));
db.close();
