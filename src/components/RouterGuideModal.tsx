import { useEffect } from 'react'
import './RouterGuideModal.css'

type Props = {
  open: boolean
  onClose: () => void
}

export function RouterGuideModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="router-guide-overlay" role="presentation" onClick={onClose}>
      <div
        className="router-guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="router-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="router-guide-head">
          <h2 id="router-guide-title">Auto / エンジン — 説明・設定例</h2>
          <button type="button" onClick={onClose} title="閉じる">
            ×
          </button>
        </div>
        <div className="router-guide-body">
          <section>
            <h3>1. プログラム開発向き／不向き</h3>
            <table>
              <thead>
                <tr>
                  <th>エンジン</th>
                  <th>向いていること</th>
                  <th>向いていない／弱いこと</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Claude</td>
                  <td>設計・要件・レビュー・大規模リファクタ</td>
                  <td>単価高め。軽い雑談には過剰。クレジット切れに注意</td>
                </tr>
                <tr>
                  <td>OpenAI</td>
                  <td>実装・小〜中規模修正、Agent の編集／検証</td>
                  <td>超長文の設計議論は Claude に負けやすいことが多い</td>
                </tr>
                <tr>
                  <td>Gemini</td>
                  <td>要約・翻訳・軽い Q&A、スクショ理解</td>
                  <td>Agent ツール非対応（編集ループ向きではない）</td>
                </tr>
                <tr>
                  <td>Cursor</td>
                  <td>リポジトリ全体の重い Agent（明示選択）</td>
                  <td>日常 Ask には重い。Auto では原則避ける</td>
                </tr>
                <tr>
                  <td>Workers AI</td>
                  <td>極短い質問・コスト最優先の下書き</td>
                  <td>本格コーディング・Agent には不向き</td>
                </tr>
              </tbody>
            </table>
            <p>
              ざっくり: 設計 → Claude ／ 実装・Agent → OpenAI（または Claude） ／ 要約・軽い確認 →
              Gemini ／ Workers は主戦力にしない ／ Cursor は重いときだけ。
            </p>
          </section>

          <section>
            <h3>2. Auto カテゴリ（開発）の振り分け例</h3>
            <ul>
              <li>
                <strong>開発（設計・要件）</strong> → Claude（Agent も Claude → OpenAI）
              </li>
              <li>
                <strong>開発（実装）</strong> → OpenAI（Agent も OpenAI → Claude）
              </li>
              <li>
                <strong>開発（テスト）</strong> → OpenAI
              </li>
              <li>
                <strong>開発（ドキュメント）</strong> → Gemini（Agent 時は OpenAI）
              </li>
            </ul>
          </section>

          <section>
            <h3>3. 開発以外（いま使えるカテゴリ）</h3>
            <ul>
              <li>文章作成 → Gemini</li>
              <li>要約・翻訳 → Gemini</li>
              <li>解説・学習 → OpenAI</li>
              <li>ブレインストーム → Claude</li>
              <li>リサーチ・比較 → Claude</li>
              <li>表計算・データ整形 → OpenAI</li>
              <li>サポート文面 / 議事録 → Gemini</li>
              <li>スライド構成 → Claude</li>
              <li>画像理解（スクショ等）→ Gemini</li>
              <li>画像生成 → OpenAI Images（専用レーン）</li>
              <li>動画理解 → Gemini（重要コマのスクショ添付推奨）</li>
            </ul>
          </section>

          <section>
            <h3>4. 補足</h3>
            <p className="router-guide-note">
              設定の Auto タブでカテゴリの有効／無効を変えられます。チャットでは「自動」エンジン時にカテゴリを選べます。
              音声の生ファイル起こしは別 API が必要です（起こしテキストの整理は「議事録・メモ整理」）。
            </p>
          </section>
        </div>
        <div className="router-guide-foot">
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
