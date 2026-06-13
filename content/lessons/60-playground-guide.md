# Playground の使い方

このコースには、ブラウザの中だけで動く SQL Playground が付いています。インストール不要、環境構築不要。本文中の SQL をその場で実行し、結果を見ながら手を動かして学べます。読むだけで終わらせず、ここで必ず「自分で叩いて」ください。

:::tip
SQL は、読んで分かったつもりになりやすい技術です。実際に実行して結果がズレた瞬間に、理解が一段深くなります。
:::

## 使えるテーブル

Playground にはこのコース共通のサンプルデータが最初から入っています。ソース系（生データ）の5テーブルです。

| テーブル | 中身 | 主なカラム |
|---|---|---|
| customers | 顧客 | customer_id, name, country, signup_date |
| products | 商品 | product_id, name, category, price |
| orders | 注文 | order_id, customer_id, order_date, status |
| order_items | 注文明細 | order_item_id, order_id, product_id, quantity, unit_price |
| events | 行動ログ | event_id, customer_id, event_type, event_time |

`orders.status` は `completed` / `cancelled` / `pending` の3種類、`events.event_type` は `view` / `add_to_cart` / `purchase` の3種類です。後のレッスンで作る分析系テーブル（fct_orders や dim_customer）も、元をたどればこの5つから生まれます。

## まず動かす

最初の一歩は、テーブルの中身を覗くこと。エディタに貼って実行ボタンを押すだけです。

```sql
SELECT * FROM customers LIMIT 5;
```

件数を数えたり、グループごとに集計したりもすぐできます。

```sql
SELECT status, COUNT(*) AS order_count
FROM orders
GROUP BY status;
```

複数テーブルを結合して「誰が何を買ったか」を出すのも、Playground の中だけで完結します。

```sql
SELECT c.name, p.name AS product, oi.quantity
FROM orders o
JOIN customers c   ON c.customer_id = o.customer_id
JOIN order_items oi ON oi.order_id   = o.order_id
JOIN products p     ON p.product_id  = oi.product_id
WHERE o.status = 'completed'
LIMIT 10;
```

## 例題の流れ

各レッスンの SQL は「貼る → 実行 → 結果を確認 → 1か所だけ変えてもう一度実行」の順で試すのがおすすめです。たとえば上のクエリの `'completed'` を `'cancelled'` に変えると結果がどう変わるか。WHERE を外すと件数がどう増えるか。1要素だけ動かして差分を観察すると、各句の役割が体で分かります。

## リセットの仕方

書き換えたり消したりしても大丈夫です。Playground のデータはあなたのブラウザの中だけにあり、本物のデータベースには一切影響しません。おかしくなったら「リセット」ボタンを押せば、サンプルデータが初期状態に戻ります。安心して壊しながら学んでください。

:::warning
Playground は学習用のサンドボックスです。件数も少なく、本番の規模・整合性とは別物です。「ここで動いた SQL がそのまま本番で通る」とは考えないでください。文法と考え方を掴む場所、と割り切るのが正解です。
:::

## 学習との連動

レッスンに「## 演習」が出てきたら、答えを読む前にまず Playground で自分のクエリを書いてみてください。実行して、想定と合っているか確かめる。違っていたら、なぜ違うのかを考える。この往復が、コースで一番伸びる時間です。

## 演習

問1: `completed` の注文だけを対象に、国（country）ごとの注文件数を多い順に並べてください。

```sql
SELECT c.country, COUNT(*) AS order_count
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
WHERE o.status = 'completed'
GROUP BY c.country
ORDER BY order_count DESC;
```

問2: `events` から `event_type` ごとのイベント数を数えてください。

```sql
SELECT event_type, COUNT(*) AS cnt
FROM events
GROUP BY event_type;
```

## まとめ

- Playground はブラウザ内で完結する SQL 実行環境。インストール不要で本文の SQL をすぐ試せる。
- 入っているのは共通サンプルの5テーブル（customers / products / orders / order_items / events）。
- 「貼る → 実行 → 1か所変えて再実行」で差分を観察すると理解が速い。
- データはブラウザ内だけ。壊してもリセットで初期状態に戻せるので安心して試せる。
- 演習は答えを見る前に自分で書く。この往復が一番伸びる。
