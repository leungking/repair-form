import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import { extend } from 'flarum/common/extend';
import DiscussionPage from 'flarum/forum/components/DiscussionPage';
import m from 'mithril';

// Repair threads live under the 管家处 tag (6); status is one of the
// child tags: 10 待处理 / 11 处理中 / 12 已完成. Status labels are read
// from the tag store at runtime, never hardcoded as the source of truth.
const REPAIR_PARENT_TAG_ID = '6';
const REPAIR_STATUS_IDS = ['10', '11', '12'];
const REPAIR_STATUS_FALLBACK: Record<string, string> = {
  '10': '待处理',
  '11': '处理中',
  '12': '已完成',
};

function currentUserIsRepairHandler(): boolean {
  const user = (app as any).session.user;
  if (!user) return false;
  try {
    if (typeof user.isAdmin === 'function' && user.isAdmin()) return true;
  } catch (e) {
    // fall through to group check
  }
  try {
    const ids = (user.groups() || []).map((g: any) => String(g.id()));
    return ids.includes('11');
  } catch (e) {
    return false;
  }
}

function tagNameById(id: string): string {
  try {
    const tags = (app as any).store.all('tags') || [];
    const found = tags.find((t: any) => String(t.id()) === String(id));
    if (found && found.name()) return found.name();
  } catch (e) {
    // fall through to fallback
  }
  return REPAIR_STATUS_FALLBACK[id] || id;
}

class RepairsPage extends Component {
  loading: boolean = true;
  items: any[] = [];
  meta: any = null;
  status: number = 0;
  q: string = '';
  page: number = 1;
  error: string | null = null;

  oninit(vnode: any) {
    super.oninit(vnode);

    // Guests only see the login prompt: no API request here, so no 403
    // global alert is triggered (same treatment as /my-houses).
    if (!(app as any).session.user) {
      this.loading = false;
      return;
    }

    this.fetch();
  }

  fetch() {
    this.loading = true;
    this.error = null;

    const params: string[] = [`page=${this.page}`, 'per_page=50'];
    if (this.status) params.push(`status=${this.status}`);
    if (this.q.trim()) params.push(`q=${encodeURIComponent(this.q.trim())}`);

    (app as any)
      .request({ method: 'GET', url: '/api/hooey/repairs?' + params.join('&') })
      .then(
        (res: any) => {
          this.items = res.data || [];
          this.meta = res.meta || null;
          this.loading = false;
          m.redraw();
        },
        () => {
          this.error = '加载失败，请刷新重试。';
          this.loading = false;
          m.redraw();
        }
      );
  }

  view() {
    if (!(app as any).session.user) {
      return m('div.HooeyRepairs', [m('h2', '维修列表'), m('p', '请先登录后查看。')]);
    }

    if (this.loading) {
      return m('div.HooeyRepairs', [m('h2', '维修列表'), m('p', '加载中…')]);
    }

    if (this.error) {
      return m('div.HooeyRepairs', [m('h2', '维修列表'), m('p', this.error)]);
    }

    const scopeNote = this.meta && this.meta.scope === 'all' ? '全部维修单（物业 / 管理员视角）' : '我的维修单';
    const options = (this.meta && this.meta.status_options) || [];
    const total = this.meta ? this.meta.total : this.items.length;

    return m('div.HooeyRepairs', { style: 'max-width:760px; margin:0 auto; padding:16px;' }, [
      m('h2', '维修列表'),
      m('p', scopeNote),
      m('div', { style: 'margin:8px 0;' }, [
        m('button.Button', { onclick: () => { this.status = 0; this.page = 1; this.fetch(); } }, '全部'),
        ...options.map((o: any) =>
          m(
            'button.Button',
            {
              style: 'margin-left:6px;',
              disabled: this.status === o.id,
              onclick: () => { this.status = o.id; this.page = 1; this.fetch(); },
            },
            o.name
          )
        ),
      ]),
      m('div.Form-group', [
        m('input.FormControl', {
          type: 'text',
          value: this.q,
          placeholder: '搜索标题关键词',
          oninput: (e: any) => { this.q = e.target.value; },
        }),
        m('button.Button', { style: 'margin-top:6px;', onclick: () => { this.page = 1; this.fetch(); } }, '搜索'),
      ]),
      this.items.length === 0
        ? m('p', '暂无维修单。')
        : m(
            'ul',
            { style: 'list-style:none; padding:0;' },
            this.items.map((d: any) =>
              m('li', { style: 'padding:8px 0; border-bottom:1px solid #eee;' }, [
                m('a', { href: '/d/' + d.id, oncreate: (v: any) => { v.dom.onclick = (e: any) => { e.preventDefault(); m.route.set('/d/' + d.id); }; } }, d.title),
                m('span', { style: 'margin-left:8px;' }, d.status_label || ''),
                m('span', { style: 'margin-left:8px; color:#888;' }, `${d.username || ''} · ${d.comment_count} 回复`),
              ])
            )
          ),
      m('div', { style: 'margin-top:12px;' }, [
        m('span', `共 ${total} 条，第 ${this.page} 页`),
        m('button.Button', { style: 'margin-left:8px;', disabled: this.page <= 1, onclick: () => { this.page--; this.fetch(); } }, '上一页'),
        m('button.Button', { style: 'margin-left:6px;', disabled: this.items.length < 50, onclick: () => { this.page++; this.fetch(); } }, '下一页'),
      ]),
    ]);
  }
}

// NOTE: Flarum 2.x DefaultResolver only accepts Component subclasses (or lazy
// imports) as route components. A plain object component is treated as an
// async import, called as a function, and the resulting error silently
// redirects to the homepage. Hence this page is a Component subclass.
class RepairPage extends Component {
  loading: boolean = true;
  houses: any[] = [];
  title: string = '';
  content: string = '';
  houseId: string = '';
  submitting: boolean = false;
  error: string | null = null;

  oninit(vnode: any) {
    super.oninit(vnode);

    // Guests only see the login prompt: no API request here, so no 403
    // global alert is triggered.
    if (!(app as any).session.user) {
      this.loading = false;
      return;
    }

    (app as any)
      .request({ method: 'GET', url: '/api/hooey/my-residences' })
      .then(
        (res: any) => {
          this.houses = res.data || [];
          this.loading = false;
          m.redraw();
        },
        () => {
          this.houses = [];
          this.loading = false;
          m.redraw();
        }
      );
  }

  selectedHouse(): any {
    return this.houses.find((h: any) => String(h.id) === String(this.houseId)) || null;
  }

  submit(e: any) {
    e.preventDefault();

    if (!this.title.trim() || !this.content.trim()) {
      this.error = '请填写标题和维修内容。';
      return;
    }

    this.submitting = true;
    this.error = null;

    let body = this.content.trim();
    const house = this.selectedHouse();
    if (house) {
      body = `房屋：${house.community}${house.building}${house.unit}${house.room_no}\n\n` + body;
    }

    (app as any)
      .request({
        method: 'POST',
        url: '/api/discussions',
        body: {
          data: {
            type: 'discussions',
            attributes: { title: this.title.trim(), content: body },
            relationships: {
              tags: { data: [{ type: 'tags', id: '6' }, { type: 'tags', id: '10' }] },
            },
          },
        },
      })
      .then(
        (res: any) => {
          const id = res.data && res.data.id;
          m.route.set('/d/' + id);
        },
        () => {
          this.submitting = false;
          this.error = '提交失败，请检查权限后重试。';
          m.redraw();
        }
      );
  }

  view() {
    if (!(app as any).session.user) {
      return m('div.HooeyRepair', [m('h2', '维修申报'), m('p', '请先登录后申报维修。')]);
    }

    if (this.loading) {
      return m('div.HooeyRepair', [m('h2', '维修申报'), m('p', '加载中…')]);
    }

    return m('div.HooeyRepair', { style: 'max-width:640px; margin:0 auto; padding:16px;' }, [
      m('h2', '维修申报'),
      m('p', '提交后将在管家处版块生成维修帖，状态为待处理。'),
      this.error ? m('div.Alert.Alert--error', this.error) : null,
      m('form', { onsubmit: (e: any) => this.submit(e) }, [
        m('div.Form-group', [
          m('label.label', '标题'),
          m('input.FormControl', {
            type: 'text',
            value: this.title,
            placeholder: '例如：厨房水管漏水',
            oninput: (e: any) => {
              this.title = e.target.value;
            },
          }),
        ]),
        m('div.Form-group', [
          m('label.label', '维修内容'),
          m('textarea.FormControl', {
            value: this.content,
            placeholder: '请描述故障情况、位置等',
            rows: 5,
            oninput: (e: any) => {
              this.content = e.target.value;
            },
          }),
        ]),
        m('div.Form-group', [
          m('label.label', '房屋（可选）'),
          m('select.FormControl', {
            value: this.houseId,
            onchange: (e: any) => {
              this.houseId = e.target.value;
            },
          }, [
            m('option', { value: '' }, '不选择'),
            ...this.houses.map((h: any) =>
              m('option', { value: String(h.id) }, `${h.community}${h.building}${h.unit}${h.room_no}`)
            ),
          ]),
        ]),
        m('button.Button.Button--primary[type=submit]', { disabled: this.submitting }, this.submitting ? '提交中…' : '提交维修申报'),
      ]),
    ]);
  }
}

// Cache of discussion id -> tag ids, filled by the one-time fallback
// fetch below (used when discussion.tags() is empty on direct loads).
const discussionTagCache = new Map<string, string[]>();
const discussionTagFetching = new Set<string>();
let repairStatusError: string | null = null;

(app as any).initializers.add('leungking-repair-form', () => {
  (app as any).routes['hooey.repair'] = {
    path: '/repair',
    component: RepairPage,
  };

  (app as any).routes['hooey.repairs'] = {
    path: '/repairs',
    component: RepairsPage,
  };

  // One-click status change on repair threads, for handlers only
  // (property / Mod / admin). The author only sees the status and can
  // follow up by replying; the button never renders for anyone else.
  extend((DiscussionPage as any).prototype, 'sidebarItems', function (this: any, items: any) {
    try {
      const discussion = this.discussion;
      if (!discussion || !currentUserIsRepairHandler()) return;

      const discussionId = String(discussion.id());
      let tagIds: string[] = [];

      try {
        tagIds = (discussion.tags() || []).map((t: any) => String(t.id()));
      } catch (e) {
        tagIds = [];
      }

      if (!tagIds.length && discussionTagCache.has(discussionId)) {
        tagIds = discussionTagCache.get(discussionId) || [];
      }

      if (!tagIds.length) {
        // Direct loads may not populate discussion.tags(); fetch the
        // linkage once from the discussion API and redraw.
        if (!discussionTagFetching.has(discussionId)) {
          discussionTagFetching.add(discussionId);
          (app as any)
            .request({ method: 'GET', url: '/api/discussions/' + discussionId })
            .then(
              (res: any) => {
                const linked = (res.data && res.data.relationships && res.data.relationships.tags && res.data.relationships.tags.data) || [];
                discussionTagCache.set(discussionId, linked.map((t: any) => String(t.id)));
                m.redraw();
              },
              () => {
                discussionTagFetching.delete(discussionId);
              }
            );
        }
        return;
      }

      if (!tagIds.includes(REPAIR_PARENT_TAG_ID)) return;

      const current = tagIds.find((id: string) => REPAIR_STATUS_IDS.includes(id)) || null;

      const changeStatus = (statusId: string) => {
        repairStatusError = null;
        (app as any)
          .request({
            method: 'POST',
            url: '/api/hooey/repairs/' + discussionId + '/status',
            body: { status_tag_id: parseInt(statusId, 10) },
          })
          .then(
            () => {
              window.location.reload();
            },
            () => {
              repairStatusError = '改状态失败，请检查权限后重试。';
              m.redraw();
            }
          );
      };

      items.add(
        'repair-status',
        m('div', { style: 'margin:12px 0;' }, [
          m('div', { style: 'font-weight:bold; margin-bottom:6px;' }, '维修状态'),
          repairStatusError ? m('div.Alert.Alert--error', repairStatusError) : null,
          m(
            'div',
            REPAIR_STATUS_IDS.map((sid: string) =>
              m(
                'button.Button',
                {
                  style: 'margin-right:6px; margin-bottom:6px;',
                  disabled: current === sid,
                  onclick: () => changeStatus(sid),
                },
                tagNameById(sid)
              )
            )
          ),
        ]),
        80
      );
    } catch (e) {
      // Never break the discussion page on a sidebar failure.
    }
  });
});
