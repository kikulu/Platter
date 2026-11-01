# 免責聲明 · Disclaimer · 免責事項

<p align="center">
  <a href="#繁體中文">繁體中文</a> ·
  <a href="#english">English</a> ·
  <a href="#日本語">日本語</a>
</p>

> 本文件補充 [LICENSE.txt](./LICENSE.txt)（MIT License）的「依現狀提供、不附任何擔保」條款，不取代也不修改它；兩者有出入時以 LICENSE.txt 為準。
> 本文件不是法律意見。This document is not legal advice. 本書は法的助言ではありません。

## 繁體中文

Platter 是個人開發、以 MIT 授權釋出的開源軟體。使用、修改或散佈本軟體，即表示你已閱讀並同意以下說明。

1. **依現狀提供，不附擔保。** 本軟體以「現狀」提供，不保證可用性、正確性、穩定性、適用於特定用途，或不侵害他人權利。作者與貢獻者不對使用或無法使用本軟體所造成的任何直接或間接損害負責，包括資料遺失、帳號受限、營業損失。

2. **非官方專案，與各平台無隸屬關係。** Platter 與 Anthropic（Claude）、OpenAI（ChatGPT）、Google（Gemini）、xAI（Grok）、Microsoft（Copilot）及其他被整合的服務**沒有任何隸屬、授權、贊助或背書關係**。這些名稱與商標屬於各自權利人，本專案僅以識別為目的提及。

3. **第三方服務條款由使用者自行遵守。** Platter 在視窗中載入各平台的網頁，並讀取畫面上已渲染的內容來匯出對話，不呼叫平台未公開的 API（見 README「設計原則」）。但各平台的服務條款、使用政策可能限制自動化、擷取或匯出，且可能隨時變更。你需要自行確認並遵守你所使用平台的條款；作者不保證本軟體的使用方式符合任何平台的條款，對因此產生的警告、限流、停權或其他後果概不負責。

4. **平台改版可能使功能失效。** 對話擷取依賴各平台網頁的結構，平台改版後可能擷取不到、擷取不完整或內容錯置。匯出結果請自行核對，重要資料不要只依賴匯出檔。

5. **你的資料存放在你自己的電腦上。** 帳號資料、對話庫、知識庫、文件庫與日誌以未加密的檔案儲存在本機（位置見 README「設定檔位置」），登入狀態由 Electron 的獨立 session 分區保存。據作者所知，目前程式碼沒有內建遙測或自動回傳資料；但被載入的第三方網站、你安裝的擴充功能，以及你自己匯出、分享的檔案，不在本專案控制範圍。請自行保護電腦與備份檔，匯出檔可能含有敏感對話內容，分享前請確認。

6. **AI 產出的內容可能不正確。** 本軟體整理、匯出或轉貼的內容來自第三方 AI 服務，可能有錯誤、過時或偏誤；內建的提示詞範本與角色範本僅供參考。這些內容不構成醫療、法律、財務或其他專業建議，使用前請自行查證，後果由使用者承擔。

7. **擴充功能與外部連結風險自負。** 你自行載入的 Chrome 擴充功能會取得它所要求的權限，並套用到各帳號分頁。請只安裝你信任的擴充功能。從文件預覽點開的外部連結會交給系統瀏覽器，內容不由本專案控制。

8. **檔案操作請先備份。** 匯入、編輯（PDF／DOCX）、匯出、還原備份與刪除等操作可能覆寫或刪除檔案。使用前請先備份重要資料。

9. **資安。** 本專案做過資安檢查並持續修補（見 [資安檢查報告](./docs/SECURITY_AUDIT_REPORT.md)），但不保證沒有漏洞。請只匯入你信任來源的備份檔與專案範本檔，並保持 Electron 與相依套件更新。

10. **責任限制。** 在法律允許的最大範圍內，作者與貢獻者不就本軟體負任何責任。不同地區的法律可能不允許排除或限制某些責任，此時以該地法律的最低要求為限。

## English

Platter is an open-source project developed by an individual and released under the MIT License. By using, modifying or distributing it you acknowledge the following.

1. **Provided "as is", without warranty.** The software is provided as is, with no warranty of availability, accuracy, stability, fitness for a particular purpose or non-infringement. The authors and contributors are not liable for any direct or indirect damage arising from its use or inability to use it, including data loss, account restrictions or lost business.

2. **Unofficial; no affiliation.** Platter is **not affiliated with, authorized, sponsored or endorsed by** Anthropic (Claude), OpenAI (ChatGPT), Google (Gemini), xAI (Grok), Microsoft (Copilot) or any other integrated service. Those names and trademarks belong to their respective owners and are used here for identification only.

3. **You are responsible for third-party terms.** Platter loads each platform's website in a window and exports conversations by reading content already rendered on screen; it does not call undocumented APIs (see "Design Principles" in the README). Still, a platform's terms of service or usage policies may restrict automation, scraping or export, and may change at any time. You must check and comply with the terms of every platform you use. The authors make no promise that your use complies with any platform's terms and are not responsible for warnings, rate limits, suspensions or other consequences.

4. **Platform changes can break features.** Conversation capture depends on each website's page structure. After a redesign, capture may fail, be incomplete or misplace content. Verify exports yourself, and do not rely on an export as the only copy of important data.

5. **Your data stays on your computer.** Accounts, conversation library, knowledge base, document library and logs are stored unencrypted on your machine (see "Config File Locations" in the README); sign-in state is kept in Electron's per-account session partitions. To the authors' knowledge the code currently contains no telemetry or automatic data upload; however, the third-party websites you load, extensions you install, and files you export or share are outside this project's control. Protect your computer and backups; exports may contain sensitive conversations, so check before sharing.

6. **AI-generated content may be wrong.** Content that the software organizes, exports or pastes comes from third-party AI services and may be inaccurate, outdated or biased. Bundled prompt and role templates are examples only. None of it is medical, legal, financial or other professional advice; verify before relying on it, at your own risk.

7. **Extensions and external links are at your own risk.** Chrome extensions you load receive the permissions they request and apply to every account tab. Install only extensions you trust. External links opened from document previews are handed to your system browser; this project does not control their content.

8. **Back up before file operations.** Importing, editing (PDF/DOCX), exporting, restoring backups and deleting can overwrite or remove files. Back up important data first.

9. **Security.** The project has been security-reviewed and is patched on an ongoing basis (see the [security audit report](./docs/SECURITY_AUDIT_REPORT.md)), but no vulnerability-free guarantee is made. Import backups and project templates only from sources you trust, and keep Electron and dependencies up to date.

10. **Limitation of liability.** To the maximum extent permitted by law, the authors and contributors accept no liability for the software. Where local law does not allow certain liability to be excluded or limited, liability is limited to the minimum that law requires.

## 日本語

Platter は個人が開発し、MIT ライセンスで公開しているオープンソースソフトウェアです。本ソフトウェアを使用・改変・再配布した場合、以下の内容に同意したものとみなします。

1. **現状有姿・無保証。** 本ソフトウェアは「現状のまま」提供され、可用性、正確性、安定性、特定目的への適合性、権利非侵害を含め、一切の保証はありません。使用または使用不能から生じた直接的・間接的な損害（データの消失、アカウントの制限、事業上の損失など）について、作者および貢献者は責任を負いません。

2. **非公式であり、各社とは無関係です。** Platter は Anthropic（Claude）、OpenAI（ChatGPT）、Google（Gemini）、xAI（Grok）、Microsoft（Copilot）その他の連携サービスと**提携・許諾・後援・推奨の関係にありません**。これらの名称および商標は各権利者に帰属し、識別のためにのみ記載しています。

3. **第三者の利用規約はご自身で遵守してください。** Platter は各プラットフォームのウェブページをウィンドウに読み込み、画面にすでに描画された内容を読み取って会話をエクスポートします。非公開 API は呼び出しません（README の「設計原則」参照）。ただし、各プラットフォームの利用規約やポリシーは自動化・取得・エクスポートを制限している場合があり、予告なく変更されることがあります。利用するプラットフォームの規約はご自身で確認し、遵守してください。作者は、本ソフトウェアの使い方がいずれかの規約に適合することを保証せず、警告、利用制限、アカウント停止などの結果について責任を負いません。

4. **プラットフォームの変更により機能が使えなくなることがあります。** 会話の取得は各サイトのページ構造に依存します。サイトの改修後、取得できない、不完全になる、内容がずれるといったことが起こり得ます。エクスポート結果はご自身で確認し、重要なデータをエクスポートファイルだけに頼らないでください。

5. **データはお使いのコンピューター上に保存されます。** アカウント、会話ライブラリ、ナレッジベース、ドキュメントライブラリ、ログは暗号化されないファイルとしてローカルに保存され（README の「設定ファイルの保存場所」参照）、ログイン状態は Electron のアカウントごとのセッション領域に保持されます。作者の知る限り、現在のコードにテレメトリーやデータの自動送信は含まれていません。ただし、読み込まれる第三者のウェブサイト、インストールした拡張機能、エクスポート・共有したファイルは本プロジェクトの管理外です。コンピューターとバックアップを適切に保護してください。エクスポートには機密性のある会話が含まれる場合があるため、共有前にご確認ください。

6. **AI が生成した内容は誤りを含む可能性があります。** 本ソフトウェアが整理・エクスポート・貼り付けする内容は第三者の AI サービスによるもので、不正確・古い・偏りがある場合があります。同梱のプロンプトおよびロールのテンプレートは参考例です。医療・法律・財務その他の専門的助言ではありません。利用前にご自身で確認し、自己責任でご利用ください。

7. **拡張機能と外部リンクは自己責任です。** 読み込んだ Chrome 拡張機能は要求した権限を取得し、すべてのアカウントのタブに適用されます。信頼できる拡張機能のみをインストールしてください。ドキュメントのプレビューから開く外部リンクはシステムのブラウザーに渡され、その内容は本プロジェクトの管理外です。

8. **ファイル操作の前にバックアップを。** インポート、編集（PDF/DOCX）、エクスポート、バックアップの復元、削除などはファイルを上書き・削除する場合があります。重要なデータは事前にバックアップしてください。

9. **セキュリティ。** 本プロジェクトはセキュリティ監査を行い継続的に修正していますが（[セキュリティ監査レポート](./docs/SECURITY_AUDIT_REPORT.md)参照）、脆弱性がないことは保証しません。信頼できる提供元のバックアップとプロジェクトテンプレートのみをインポートし、Electron と依存パッケージを最新に保ってください。

10. **責任の制限。** 法律で認められる最大限の範囲で、作者および貢献者は本ソフトウェアについて一切の責任を負いません。お住まいの地域の法律が特定の責任の免除・制限を認めない場合は、その法律が求める最小限の範囲に限ります。
