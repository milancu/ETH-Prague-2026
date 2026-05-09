# Design: komentáře k marketům

**Datum:** 2026-05-09  
**Scope:** `apps/api` (backend) + `apps/web` (frontend)

---

## Kontext

Uživatelé mohou komentovat jednotlivé markety. Komentáře jsou off-chain metadata — ukládají se v backend DB stejně jako `Market` metadata. Komentáře nevyžadují žádnou on-chain akci.

---

## Datový model

Nová tabulka `comments` v SQLite (SQLModel):

| Sloupec      | Typ            | Poznámka                                      |
|--------------|----------------|-----------------------------------------------|
| `id`         | `int` (PK)     | auto-increment                                |
| `market_id`  | `int` (index)  | FK → `markets.market_id`                      |
| `parent_id`  | `int \| NULL`  | FK → `comments.id`; NULL = kořenový komentář |
| `author`     | `str` (42)     | Ethereum adresa (lowercase)                   |
| `content`    | `str`          | max 2000 znaků                                |
| `created_at` | `datetime`     | UTC, server-side default                      |

Hloubka vrstvení je neomezená — každý komentář odkazuje na svého přímého rodiče přes `parent_id`.

---

## API

### `GET /markets/{market_id}/comments`

Vrátí vnořený strom komentářů pro daný market. Veřejný endpoint, nevyžaduje auth.

**Response:** `200 CommentNode[]`

```python
class CommentNode(BaseModel):
    id: int
    author: str
    content: str
    created_at: datetime
    replies: list["CommentNode"]
```

Backend načte všechny komentáře pro market jedním SQL dotazem (`SELECT * FROM comments WHERE market_id = ?`), pak sestaví strom v Pythonu přes dict lookup — O(n), žádná rekurze do DB.

### `POST /markets/{market_id}/comments`

Vytvoří nový komentář. Vyžaduje SIWE autentizaci (stejný middleware jako ostatní write endpointy).

**Request body:**
```python
class CommentCreate(BaseModel):
    content: str  # max 2000 znaků, stripped, non-empty
    parent_id: int | None = None
```

**Response:** `201 CommentNode` (nový komentář, `replies: []`)

**Validace:**
- `content` po `.strip()` nesmí být prázdný
- pokud `parent_id` není `None`, musí existovat a patřit ke stejnému `market_id`; jinak `422 Unprocessable Entity`

---

## Sestavení stromu (backend logika)

```python
def build_tree(comments: list[Comment]) -> list[CommentNode]:
    nodes = {c.id: CommentNode(**c.dict(), replies=[]) for c in comments}
    roots = []
    for c in comments:
        if c.parent_id is None:
            roots.append(nodes[c.id])
        else:
            nodes[c.parent_id].replies.append(nodes[c.id])
    return roots
```

Komentáře jsou seřazeny podle `created_at ASC` před sestavením — kořeny i replies zachovávají chronologické pořadí.

---

## Frontend

Sekce komentářů se přidá na stránku `/market/:id` pod trading panel.

### Komponenty

```
<CommentsSection marketId={id} />
  ├── <CommentComposer />              ← textarea + tlačítko Submit
  │     (zobrazí se jen pokud je wallet připojen)
  └── <CommentThread comments={CommentNode[]} />
        └── <CommentItem comment={CommentNode} />
              ├── zkrácená adresa autora + relativní čas
              ├── obsah komentáře
              ├── "Odpovědět" → inline <CommentComposer parentId={id} />
              └── <CommentThread comments={comment.replies} />   ← rekurze
```

### Data fetching

- `useQuery` (TanStack Query) na `GET /markets/:id/comments`
- Po úspěšném `POST` invalidace query klíče → strom se znovu načte ze serveru
- Žádný optimistický update

### Auth

- `<CommentComposer>` je disabled (s tooltip) pokud wallet není připojen
- `POST` volání posílá SIWE session token v hlavičce (stejný pattern jako ostatní autentizované requesty)
- Adresa autora se bere ze SIWE session na serveru — frontend ji neposílá v body

---

## Co je mimo scope

- Moderace (mazání, reportování, hlasování)
- Editace komentářů
- Stránkování
- Notifikace (e-mail, push)
- On-chain komentáře

---

## Závislosti

- SIWE middleware musí být hotový (`T3.5`) než se dá napsat `POST` endpoint
- Market detail stránka (`T2.3`) musí existovat před přidáním `<CommentsSection>`
- DB migrace přes Alembic (nová tabulka `comments`)
