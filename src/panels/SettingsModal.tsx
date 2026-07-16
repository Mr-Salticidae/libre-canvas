import { useState } from 'react'
import { useProviders } from '../providers'
import { useUI } from '../ui'
import { uid, type Provider } from '../types'
import { testProvider } from '../api/openai'

const PRESETS: { name: string; baseURL: string; models: string }[] = [
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1', models: 'gpt-4o-mini, gpt-image-1' },
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', models: 'deepseek-chat' },
  { name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', models: 'Kwai-Kolors/Kolors' },
  { name: '智谱 AI', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: 'glm-4-flash, cogview-3-flash' },
]

function emptyProvider(): Provider {
  return { id: uid(), name: '', baseURL: '', apiKey: '', models: [] }
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

  if (!open) return null

  const edit = (p: Provider) => {
    setDraft({ ...p })
    setModelsText(p.models.join(', '))
    setTestMsg(null)
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
    setTestMsg(await testProvider({ ...draft, models: [] }))
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
