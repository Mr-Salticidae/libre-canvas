import { useState } from 'react'
import { useProviders } from '../providers'
import { useUI } from '../ui'
import { uid, type Provider } from '../types'
import { testProvider } from '../api/openai'
import { presetIds, testComfy, comfyServerStatus, startComfyServer } from '../api/comfyui'

const PRESETS: { name: string; baseURL: string; models: string }[] = [
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', models: 'gpt-4o-mini, gpt-image-1' },
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', models: 'deepseek-chat' },
  { name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', models: 'Kwai-Kolors/Kolors, deepseek-ai/DeepSeek-V3' },
  { name: '智谱 AI', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: 'glm-4-flash, cogview-3-flash' },
  { name: '火山方舟', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', models: 'doubao-seedance-2-0-260128' },
]

function emptyProvider(): Provider {
  return { id: uid(), name: '', baseURL: '', apiKey: '', models: [] }
}

/** 本地 ComfyUI：模型名是 H3 预设 id，由 comfyui.ts 定义，不需要 /models 接口 */
function comfyProvider(): Provider {
  return {
    id: uid(),
    name: '本地 ComfyUI（H3）',
    kind: 'comfyui',
    baseURL: 'http://127.0.0.1:8188',
    apiKey: '',
    models: presetIds(),
  }
}

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen)
  const setOpen = useUI((s) => s.setSettingsOpen)
  const providers = useProviders((s) => s.providers)
  const upsert = useProviders((s) => s.upsert)
  const remove = useProviders((s) => s.remove)

  const [draft, setDraft] = useState<Provider | null>(null)
  const [modelsText, setModelsText] = useState('')
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  /** 本地 ComfyUI 服务状态（只在编辑 comfyui 提供商时查） */
  const [comfyStatus, setComfyStatus] = useState<{ up: boolean; version?: string; detail?: string } | null>(null)
  const [comfyBusy, setComfyBusy] = useState(false)

  const refreshComfy = async () => {
    setComfyStatus(await comfyServerStatus())
  }

  const bootComfy = async () => {
    setComfyBusy(true)
    setComfyStatus(null)
    try {
      const r = await startComfyServer()
      if (r.state === 'already') setTestMsg({ ok: true, message: 'ComfyUI 已经在跑了' })
      else if (r.state === 'started')
        setTestMsg({ ok: true, message: `ComfyUI 已启动（${r.seconds ?? '?'} 秒${r.version ? `，版本 ${r.version}` : ''}）` })
      else setTestMsg({ ok: false, message: r.error || '启动超时，去看 ComfyUI 窗口的报错' })
    } catch (e) {
      setTestMsg({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setComfyBusy(false)
      void refreshComfy()
    }
  }

  if (!open) return null

  const edit = (p: Provider) => {
    setDraft({ ...p })
    setModelsText(p.models.join(', '))
    setTestMsg(null)
    if (p.kind === 'comfyui') {
      setComfyStatus(null)
      void refreshComfy()
    }
  }

  const commit = () => {
    if (!draft) return
    if (!draft.name.trim() || !draft.baseURL.trim()) {
      setTestMsg({ ok: false, message: '名称和 Base URL 不能为空' })
      return
    }
    upsert({
      ...draft,
      name: draft.name.trim(),
      baseURL: draft.baseURL.trim(),
      models: modelsText.split(/[,，]/).map((m) => m.trim()).filter(Boolean),
    })
    setDraft(null)
  }

  const test = async () => {
    if (!draft) return
    setTesting(true)
    setTestMsg(null)
    setTestMsg(draft.kind === 'comfyui' ? await testComfy(draft) : await testProvider({ ...draft, models: [] }))
    setTesting(false)
  }

  return (
    <div className="modal-mask" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>模型提供商设置</h2>
        <p className="privacy">
          🔒 你的 API Key 只保存在<b>本机浏览器</b>（localStorage）里，调用时由浏览器直连提供商接口，
          不经过任何中间服务器。清除浏览器数据会同时清掉 Key。
        </p>

        {!draft && (
          <>
            {providers.length === 0 && <p className="hint">还没有提供商。支持任何 OpenAI 兼容接口。</p>}
            <ul className="provider-list">
              {providers.map((p) => (
                <li key={p.id}>
                  <div>
                    <b>{p.name}</b>
                    <span className="sub">{p.baseURL}</span>
                  </div>
                  <div>
                    <button onClick={() => edit(p)}>编辑</button>
                    <button
                      onClick={() => {
                        if (confirm(`删除提供商「${p.name}」？`)) remove(p.id)
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="preset-row">
              <button className="primary" onClick={() => edit(emptyProvider())}>
                + 添加提供商
              </button>
              <button onClick={() => edit(comfyProvider())}>本地 ComfyUI（H3）</button>
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() =>
                    edit({
                      ...emptyProvider(),
                      name: preset.name,
                      baseURL: preset.baseURL,
                      models: preset.models.split(',').map((m) => m.trim()),
                    })
                  }
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </>
        )}

        {draft && (
          <div className="provider-form">
            <label>名称</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="如 OpenAI / 我的中转站" />
            {draft.kind === 'comfyui' ? (
              <>
                <label>ComfyUI 地址</label>
                <input
                  value={draft.baseURL}
                  onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
                  placeholder="http://127.0.0.1:8188"
                />
                <p className="hint">
                  本地 ComfyUI（MiniMax H3 产线），不需要 API Key。开发模式经 dev server 的 /__comfy
                  代理转发，所以 ComfyUI 不用开 CORS；打包成静态站点后直连，需要给 ComfyUI 加
                  <code> --enable-cors-header</code>。
                </p>
                <label>本地服务</label>
                <div className="row2" style={{ alignItems: 'center', gap: 8 }}>
                  <span className={comfyStatus?.up ? 'ok' : 'error'} style={{ fontSize: '0.78rem' }}>
                    {comfyStatus === null
                      ? '查询中…'
                      : comfyStatus.up
                        ? `ComfyUI${comfyStatus.version ? ` ${comfyStatus.version}` : ''} 在跑`
                        : '没在跑'}
                  </span>
                  <button onClick={() => void bootComfy()} disabled={comfyBusy || Boolean(comfyStatus?.up)}>
                    {comfyBusy ? '启动中（约 30~60 秒）…' : '启动 ComfyUI'}
                  </button>
                  <button onClick={() => void refreshComfy()} disabled={comfyBusy}>
                    ⟳ 刷新
                  </button>
                </div>
                <p className="hint">
                  「启动」走本机桥（<code>npm run post:bridge</code>）拉起 ComfyUI，参数是本机 8GB 配方
                  <code> --lowvram --async-offload --reserve-vram 0.6</code>。桥没起时这个按钮会报连不上。
                </p>
                <label>H3 预设（也可以留空，节点里再选）</label>
                <p className="hint">{modelsText || '（会用内置的四档 H3 预设）'}</p>
              </>
            ) : (
              <>
                <label>Base URL（OpenAI 兼容，一般以 /v1 结尾）</label>
                <input value={draft.baseURL} onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })} placeholder="https://api.openai.com/v1" />
                <label>API Key</label>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-…"
                  autoComplete="off"
                />
                <label>常用模型（逗号分隔，生成时可下拉选择）</label>
                <input value={modelsText} onChange={(e) => setModelsText(e.target.value)} placeholder="gpt-4o-mini, gpt-image-1" />
              </>
            )}
            {import.meta.env.DEV && draft.kind !== 'comfyui' && (
              <label className="proxy-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(draft.useProxy)}
                  onChange={(e) => setDraft({ ...draft, useProxy: e.target.checked })}
                />
                <span>
                  通过本地代理转发（解决官方 OpenAI 等接口的浏览器跨域限制）。请求经本机 dev server
                  中转再发往提供商，Key 仍只在本机、不上传任何外部服务器。仅 <code>npm run dev</code> 时可用。
                </span>
              </label>
            )}
            <div className="form-actions">
              <button onClick={() => void test()} disabled={testing}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button className="primary" onClick={commit}>
                保存
              </button>
              <button onClick={() => setDraft(null)}>取消</button>
            </div>
            {testMsg && <p className={testMsg.ok ? 'ok' : 'error'}>{testMsg.message}</p>}
          </div>
        )}

        <button className="modal-close" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
    </div>
  )
}
