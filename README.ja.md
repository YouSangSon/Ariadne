<div align="center">

<img src="docs/assets/ariadne-mark.svg" width="96" height="96" alt="Ariadneの糸" />

# Ariadne

**望む仕事が終わるまで、作業の糸をつなぎます。**

目標、コンテキスト、ツール、検証済みの結果をつなぐ統合エージェントハーネスです。

[![Verify](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml/badge.svg)](https://github.com/YouSangSon/Ariadne/actions/workflows/verify.yml)
![Node.js 24.22+](https://img.shields.io/badge/Node.js-24.22%2B-43853d?logo=nodedotjs&logoColor=white)

[한국어](README.md) · [日本語](README.ja.md) · [English](README.en.md) · [简体中文](README.zh-CN.md)

[製品の方向性](docs/product-direction.md) · [現在の機能](#features) · [はじめに](#getting-started) · [実行ポリシー](docs/execution-policy.md)

</div>

韓国語のREADMEを正本とし、4言語の構成、コマンド、サポート範囲を合わせて更新します。リンク先の詳細文書は韓国語または英語で提供されます。READMEの翻訳は、CLIがこれらの表示言語に対応していることを意味しません。

---

Ariadneは、**ユーザーの目標を実行と検証につなぐ統合エージェントハーネス**です。

ユーザーから仕事を受け、必要なコンテキスト、ツール、実行器をつなぎ、結果を確認することを目指します。
コーディング、調査、文書作成、分析、定型業務を同じワークフローで扱う方向を目指しています。

目標を何度も説明し直すこと、同じ資料を探し直すこと、失敗の原因が分からないまま呼び出しを繰り返すことを減らすことに重点を置いています。
必要な情報と検証を維持しながら、**望む結果を得るまでに必要なモデル使用量の総量**を減らすことが基準です。
汎用的な作業を自動で完了する実行器はまだ提供していません。現在の機能と実装の優先順位は、以下と[製品の方向性](docs/product-direction.md)で区別しています。

<a id="workflow"></a>

## 目指すワークフロー

1. 望む結果と完了条件を理解します。確認済みの内容は再び尋ねません。
2. 関連するコンテキストと過去の根拠を探し、作業に必要な分を渡します。
3. 権限、予算、必要な機能に合うツールと実行器を選びます。
4. 実行結果を確認し、中断した場合は確認済みの状態から再開します。

このフローは製品の目標です。現在は要件、コンテキスト、メモリ、ツール接続の基盤を提供しており、自動割り当て、実行、再開は開発中です。

<a id="features"></a>

## 現在利用できる機能

| 機能 | 実際の動作 |
| --- | --- |
| **REQに基づく作業** | 目標、受け入れ基準、制約、検証コマンドを1つの要件文書で管理 |
| **必須コンテキストの保持** | 確定した事実と検証を優先して保持し、必須情報が予算を超えた場合は出力せずに失敗 |
| **永続メモリ** | PostgreSQLを正本とし、Qdrantまたはpgvectorによる検索、組織単位の権限、HTTP・MCPツールを提供 |
| **コード影響分析** | ローカルSQLiteグラフ、変更の影響、検証対象、根拠、MCP、UI |
| **オントロジー** | ユーザー定義の用語・関係・出典ファイルを読み、限定的な語彙検索とレビュー状態の確認を提供 |
| **知識の関係** | 作業記録のWiki昇格とリンク・未解決の関係のインデックス |
| **共通ルールとスキル** | 単一の原本からCodex・Claude Code向けミラーを生成し、一致を検査 |
| **変更検知の基盤** | すべての受け入れ基準（AC）と不変スコープを含む契約ハッシュ、およびdirty・untracked・modeを含むソース指紋 |
| **制限付きファイルツール** | パス、シンボリックリンク、秘密情報、サイズ、既存SHAを検査し、一時ファイルを使って置換 |
| **API転送の基盤** | Chat Completions互換リクエストとツール応答の検証、リダイレクトのブロック、明示的なエラー分類 |

> **開発中の範囲:** タスクDB、dispatcher、自動再開、実行プール、完了証跡はまだ公開された実行機能ではありません。
> このリポジトリは、検証済みのコンテキスト補完と接続の基盤までを公開したチェックポイントです。
> API転送モジュールが存在することは、汎用作業の自動完了やネイティブCLIの無人実行を意味しません。

以下のインストール・実行手順は、必要な利用許可を得ている場合に適用されます。[ライセンス](#license) を確認してください。

<a id="getting-started"></a>

## はじめに

製品全体のインストールと実行には**Node.js 24.22.2以降**が必要です。ファイルベースのコアは外部DBなしで利用できます。永続メモリサービスにはPostgreSQLと選択したベクトルストアが必要です。以下は全体のインストール例です。必要なモジュールだけを使う場合は、クローン後に[モジュールの選択](#module-selection)に従ってください。

```sh
git clone https://github.com/YouSangSon/Ariadne.git
cd Ariadne
npm run setup
npm run verify
node bin/Ariadne.mjs --help
```

<a id="module-selection"></a>

### モジュールの選択

ソースのチェックアウトには常にすべてのモジュールが含まれます。`setup`と`verify`の`--modules`に次の名前をカンマ区切りで指定します。`core`は常に含まれ、オプションを省略すると全体をインストール・検証します。

| モジュール | 役割と必要な環境 |
| --- | --- |
| `core` | 共通ハーネス。外部DBとnpmパッケージ依存関係は不要 |
| `ontology` | JSONの用語・関係・出典の検索とレビュー。外部DBとnpmパッケージ依存関係は不要 |
| `memory` | 永続メモリ。PostgreSQLと選択したベクトルストアの設定が必要 |
| `code` | コード影響分析。対象リポジトリのローカルSQLiteを使用 |

```sh
# コアのみ、またはオントロジーのみを選択
npm run setup -- --modules core
npm run setup -- --modules ontology
# メモリとオントロジーを一緒にインストール・検証
npm run setup -- --modules memory,ontology
npm run verify -- --modules memory,ontology
```

選択したパッケージの依存関係のみをインストールします。選択は保存されないため、次回の実行時にもオプションを指定してください。既存の依存関係の削除や、他のモジュールのコマンドの非表示は行いません。

オントロジーは、ユーザーが作成したJSONの用語、同義語、型付きの関係、出典パスを使います。

```sh
node bin/Ariadne.mjs ontology inspect --file modules/ontology/example.json
node bin/Ariadne.mjs ontology search --file modules/ontology/example.json --query memory --limit 5
```

読み込みのたびに定義と出典ファイルからレビューダイジェストを再計算し、`unreviewed`、`current`、`stale`を表示します。検索は限定的な語彙検索であり、LLM・SQL・回答可能性の判定は提供しません。レビュー状態は認証済みの承認ではありません。既存の`knowledge promote`と`knowledge index`は別のWikiスナップショットを扱います。

メモリ、コード、要件、コンテキスト、ルール連携、Wiki、実行基盤、オントロジーは、それぞれの規則とデータを所有します。ドメインとアプリケーションはポートに依存し、ファイル、DB、HTTP、プロセスのアダプターを外側で接続します。既存のエントリーポイントと保存契約は維持します。所有範囲と境界検査は[アーキテクチャ](docs/architecture.md)、オントロジーの形式は[モジュールとオントロジー](docs/modular-ontology.md)を参照してください。

現在利用できるコード分析とコンテキストのコマンドは、作業対象のリポジトリで実行します。コードコマンドには`code`モジュールの依存関係が必要です。

```sh
node /path/to/Ariadne/bin/Ariadne.mjs code init
node /path/to/Ariadne/bin/Ariadne.mjs code index
node /path/to/Ariadne/bin/Ariadne.mjs code analyze --changed src/example.ts --fail-on none
node /path/to/Ariadne/bin/Ariadne.mjs context --root . --req my-task
```

メモリを使うには、`memory`モジュールの依存関係をインストールし、`packages/memory/.env.example`をルートの`.env`にコピーして、DBとベクトルの設定を確認します。実際の値はGitに含めません。デフォルトのtransformerモデルはローカルで実行され、初回実行時に重みをダウンロードする場合があります。APIキーや有料プロバイダーは自動設定されません。

```sh
node --env-file=.env bin/Ariadne.mjs memory serve
node --env-file=.env bin/Ariadne.mjs memory mcp
```

クライアント接続とリポジトリ設定は、[設定・運用ガイド](docs/consolidation.md#runtime-directories-and-agent-clients)に従います。

共通ルールとスキルを独立したインストール先にコピーします。

```sh
node scripts/install.mjs
```

既存のグローバル設定は、`--global-pointer`を選択した場合にのみ接続します。
プロジェクトへの適用と削除の手順は、[オンボーディング](docs/ONBOARDING.md)と[運用ガイド](docs/OPERATIONS.md)に従います。

<a id="responsibilities"></a>

## ルールと実行器の責任

| 対象 | Ariadneの役割 | 別途維持されるもの |
| --- | --- | --- |
| **Codex · Claude Code** | 共通の作業ルール、要件、コンテキストを提供 | 各ツールのログイン、セッション、実行権限 |
| **Gemini** | 選択可能な手動引き継ぎパケットの基盤 | ユーザーによるCLIのインストール、認証、実行 |
| **モデルAPI・Grokなど** | 互換HTTP転送と制限付きツール形式 | 別途必要なAPI認証、料金、実際のプロバイダーとの互換性検証 |

1つのツールだけを使うこともできます。複数のツールを接続しても、認証やサブスクリプションは統合されません。
有料プロバイダーへの実際の呼び出し、ネイティブの自動実行、OSレベルのプロセス分離は検証していません。

<a id="principles"></a>

## 小さなハーネスと検証可能なルール

- 必須コンテキストを先に保持します。長い任意のメモによって検証契約が失われないようにします。
- 不正なREQ ID・状態、重複するAC、未対応の構文を明示的に拒否します。
- ファイルの内容だけでなく、パス・種類・modeと未追跡の変更もソース指紋に反映します。
- 実際の失敗に対応する検査とガードを維持します。ルールやエージェントの数を目標にはしません。
- モデルの完了宣言、ローカル検査、リモートCI、実サービスの運用結果を区別します。

`AGENTS.md`は作業ルールを伝えます。スクリプトとテストは、決定論的に検査できる部分を担当します。
指示ファイルだけでバックグラウンドイベントの受信や自動復旧が実現するわけではありません。

<a id="verification"></a>

## 検証

```sh
npm run verify
# パッケージ依存関係なしでコアのソースを確認する場合
node scripts/verify.mjs
```

全体の`npm run verify`は既存のパッケージ検査を維持します。選択したモジュールを検証するには、setupと同様に`--modules`を指定します。コアのソース検査は`core`のみの選択でも共通のオントロジーソーステストを含みます。

検査では実際のファイル、一時プロジェクト、テストが起動するHTTPサーバーを使用します。CIのPostgreSQL・pgvector・ローカルtransformer検索の検証は別のジョブとして実行します。モデルの呼び出しは不要です。
APIプロトコルの検査を、モデルの品質、サブスクリプション節約率、実サービスの性能の根拠として解釈しません。
ファイルのSHA検査とrenameの間に任意の外部writerが競合する場合は保証しないため、独立した作業スペースが必要です。

<a id="repository-guide"></a>

<details>
<summary><strong>リポジトリ案内</strong></summary>

| 場所 | 役割 |
| --- | --- |
| `core/AGENTS.core.md` | 短い共通ルールの原本 |
| `skills/` | 要件、ルーティング、コンテキスト、引き継ぎスキルの原本 |
| `.agents/`, `.claude/` | ツール別の生成ミラー |
| `lib/`, `scripts/`, `tests/` | 決定論的な検査と回帰の根拠 |
| `packages/memory/`, `packages/code/` | 内部実装、固定された依存関係、既存の契約とテスト |
| `bin/Ariadne.mjs` | 単一のインストール・実行エントリーポイント |
| `modules/ontology/` | ファイルベースのオントロジーモデルと検索 |
| `modules/llm-wiki/` | Wiki昇格と関係インデックス |
| `modules/loop/` | 契約、ファイルツール、転送、手動引き継ぎの基盤 |
| `evaluation/` | モデル呼び出しのない評価装置の対照群 |

プロジェクト名とリポジトリパスは**Ariadne / `Ariadne`**です。
既存のインストールデータ形式`.harness/`、`~/.harness`、`harness-*`識別子は維持します。

</details>

<a id="license"></a>

## ライセンス

ソースコードは閲覧のために公開しています。使用・複製・改変・再配布には、著作権者の事前の書面による許可が必要です。適用法・プラットフォームの利用規約・従前のライセンスに基づく権利、および第三者のライセンスは維持されます。詳細は [LICENSE](LICENSE) を参照してください。

---

**Read the intent. Keep the thread. Verify the result.**
