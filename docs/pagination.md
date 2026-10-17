# List pagination response

Offer and order list routes return a common envelope:

```json
{
  "items": [],
  "total": 0,
  "skip": 0,
  "take": 20,
  "hasMore": false,
  "nextSkip": null
}
```

`take` is limited to 100. `nextSkip` is the offset for the next request when `hasMore` is true and is `null` for an empty or final page. Counts apply the same filters as the page query.
