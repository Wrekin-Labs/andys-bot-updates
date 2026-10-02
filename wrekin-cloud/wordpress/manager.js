const { classifyAction, assertAllowed } = require('./policy');
const { makeCheckpoint, rollbackPlan } = require('./checkpoint');
const { WordPressClient } = require('./client');

class WrekinWordPressManager {
  constructor({ auditSink = async () => {}, clientFactory } = {}) {
    this.auditSink = auditSink;
    this.clientFactory = clientFactory || ((cfg) => new WordPressClient(cfg));
  }

  capabilities() {
    return {
      inspect: ['site', 'pages', 'plugins'],
      edit: ['page_content'],
      operations: ['cache_purge', 'cron_test'],
      gated: ['core_update', 'plugin_update', 'theme_update', 'backup_restore'],
      blocked: ['paid_license_bypass', '2fa_bypass', 'payments', 'legal_acceptance']
    };
  }

  plan(action, payload = {}) {
    return { action, ...classifyAction(action, payload) };
  }

  async inspectSite(connection) {
    const client = this.clientFactory(connection);
    const [root, pages] = await Promise.all([
      client.apiIndex(),
      client.pages().catch(() => [])
    ]);
    const result = {
      ok: true,
      site: connection.baseUrl,
      wordpressName: root && root.name ? root.name : null,
      publishedPages: Array.isArray(pages) ? pages.length : 0
    };
    await this.auditSink({ type: 'wordpress.inspect', result });
    return result;
  }

  async editPage(connection, id, patch) {
    assertAllowed('content.edit.page', patch, false);
    const client = this.clientFactory(connection);
    const before = await client.page(id);
    const checkpoint = makeCheckpoint({
      id,
      title: before && before.title,
      content: before && before.content,
      status: before && before.status
    });
    const after = await client.updatePage(id, patch);
    await this.auditSink({
      type: 'wordpress.page.edit',
      site: connection.baseUrl,
      pageId: id,
      checkpointId: checkpoint.id
    });
    return { after, checkpoint, rollback: rollbackPlan(checkpoint) };
  }
}

module.exports = {
  WrekinWordPressManager,
  WordPressClient,
  classifyAction,
  assertAllowed,
  makeCheckpoint,
  rollbackPlan
};
