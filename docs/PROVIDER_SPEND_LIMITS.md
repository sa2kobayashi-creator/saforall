# Provider 側 spend limit（外側の安全装置）

saforall Router の月額上限とは別に、各クラウドのコンソールでも課金上限を設定する。  
二重化しないと、アプリ障害やバグで請求が膨らむリスクが残る。

目安（開発検証）: OpenAI $20 / Gemini $10 / Claude $10（合計 $40/月）

---

## OpenAI

1. [OpenAI Platform](https://platform.openai.com/) → **Settings → Billing / Limits**
2. **Monthly budget** または **Usage limits** で上限を設定（例: $20）
3. Soft limit（通知）と Hard limit（API 停止）があれば両方使う
4. Organization 単位で設定し、個人キーが複数あっても同じ枠に収める

公式の API Key は自動化・共有環境向け。ChatGPT / Codex サブスク枠とは別請求。

---

## Anthropic（Claude）

1. [Anthropic Console](https://console.anthropic.com/) → **Settings / Billing**
2. Organization の **spend limit** を設定（例: $10）
3. Workspace 単位の上限があれば Router 用 workspace を分けて設定
4. Rate limit も確認（急増時の暴走を抑える）

---

## Google AI（Gemini）

1. [Google AI Studio](https://aistudio.google.com/) / Cloud Billing でプロジェクトを確認
2. 無料枠 / 有料 Tier の切替と、プロジェクトの **予算アラート** を設定
3. Cloud Billing の **Budget alerts** で $10 前後の通知を入れる
4. 可能なら API キーを Router 専用に分離する

---

## 運用ルール

| 層 | 役割 |
| --- | --- |
| Provider コンソール | Hard stop（請求の最終防衛） |
| saforall Router | タスク振り分け・推定コスト・警告・フォールバック |
| ユーザープラン | 販売時の利用者ごとの月枠 |

両方を同じ金額帯に揃える。Router だけに頼らない。

変更したら `docs/PIPELINE.md` の月額表と設定画面の `cost.*.monthly_usd` も揃える。
