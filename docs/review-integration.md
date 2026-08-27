# Review integration

```text
Book Architecture
    -> REVIEW_READY chapter
    -> MaxQuill Private Review
    -> Owner Review Package
    -> Revision Pipeline
```

The Book Repository remains the source of truth. MaxQuill never changes manuscript or canon data; it stores owner annotations separately and exports them for an external revision workflow.

## Chapter input

Every review candidate declares `status: "REVIEW_READY"`, a numeric `version`, and stable paragraph objects shaped as `{ "id": "p001", "text": "..." }`. Notes are bound to that exact chapter version. A newer version receives a separate local namespace and does not inherit old highlights automatically.

## Owner Review Package

Exported JSON uses this shape:

```json
{
  "schemaVersion": 1,
  "source": "owner",
  "bookId": "demo-book",
  "chapter": 1,
  "chapterVersion": 1,
  "chapterStatus": "REVIEW_READY",
  "ownerReviewStatus": "completed",
  "reviewStartedAt": "ISO-8601 timestamp",
  "lastReviewedAt": "ISO-8601 timestamp",
  "completedAt": "ISO-8601 timestamp",
  "reviewedAt": "ISO-8601 timestamp",
  "annotations": [
    {
      "id": "annotation-uuid",
      "source": "owner",
      "bookId": "demo-book",
      "chapter": 1,
      "chapterVersion": 1,
      "paragraphId": "p001",
      "selectedText": "Selected manuscript text",
      "selectionStart": 0,
      "selectionEnd": 24,
      "type": "wording",
      "comment": "Optional owner comment",
      "status": "open",
      "createdAt": "ISO-8601 timestamp"
    }
  ]
}
```

The revision pipeline should treat `source: "owner"` as explicit owner feedback. Import, reconciliation, revision execution, and finalization are outside MaxQuill's current scope.
