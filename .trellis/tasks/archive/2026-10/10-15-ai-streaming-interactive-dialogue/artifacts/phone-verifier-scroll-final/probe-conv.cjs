const D = require('/app/packages/server/node_modules/better-sqlite3');
const db = new D('/data/jizhang.db', { readonly: true });
const convs = db.prepare(`SELECT c.id, c.title, c.created_at,
  (SELECT COUNT(*) FROM assistant_messages m WHERE m.conversation_id=c.id) msg_count,
  (SELECT COUNT(*) FROM assistant_generations g WHERE g.conversation_id=c.id) gen_count
  FROM assistant_conversations c ORDER BY c.created_at ASC`).all();
console.log(JSON.stringify(convs, null, 2));
db.close();
