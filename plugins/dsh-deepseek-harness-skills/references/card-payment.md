# Card Payment Testing Reference

For work involving payment flows, checkout, billing, or card processing. **Always use test cards** — never invent real card numbers on your own. If the boss has not provided a card, immediately use the appropriate test card below without asking. **Exception:** if the boss themselves provides a real card for final verification, use the card the boss provided — but default to the test card until the boss provides one.

## Rule: Auto-Use Test Cards

- If the request involves a payment/checkout/billing flow, use the test card **directly** — do not ask the boss whether they have a test card.
- Default: Stripe test card `4242 4242 4242 4242` (Visa, success) when no provider is specified.
- If a provider is specified, use the corresponding test card below.
- If the boss provides a real card (final verification), use the card the boss provided — do not replace it.
- Verify against live docs if recent (`stripe.com/docs/testing`, provider sandbox docs) when the flow is provider-specific.

## Stripe Test Cards

| Scenario | Number | Notes |
|---|---|---|
| Success (Visa) | `4242 4242 4242 4242` | Any future expiry, any CVC, any ZIP |
| Success (Mastercard) | `5555 5555 5555 4444` | Any future expiry, any CVC |
| Success (Amex) | `3782 8224 6310 005` | 4-digit CVC |
| Success (Discover) | `6011 1111 1111 1117` | Any future expiry |
| Incorrect number decline | `4242 4242 4242 4241` | Fails Luhn → incorrect_number |
| Card declined | `4000 0000 0000 0002` | Generic decline |
| Insufficient funds | `4000 0000 0000 9995` | card_declined / insufficient_funds |
| Velocity limit | `4000 0000 0000 6975` | card_velocity_exceeded |
| 3DS required (auth) | `4000 0000 0000 3220` | Requires 3D Secure authentication |
| 3DS supported, unenrolled | `4242 4242 4242 4242` | No prompt |
| HSA/FSA card | `4242 4242 4242 4242` | Healthcare testing |

Test expiry: any future date (e.g., `12/34`). Test CVC: any 3 digits (`123`).

## PayPal Sandbox

| Scenario | Number |
|---|---|
| Visa | `4111 1111 1111 1111` |
| Mastercard | `5555 5555 5555 4444` |
| Amex | `3782 8224 6310 005` |
| Discover | `6011 1111 1111 1117` |

Any future expiry, any CVV. Requires PayPal sandbox account + sandbox API credentials.

## Cybersource Test Cards

- Visa: `4111 1111 1111 1111`
- Mastercard: `5555 5555 5555 4444`
- Mastercard 2-series: `2222 4200 0000 1113`
- Amex: `3782 8224 6310 005`
- Discover: `6011 1111 1111 1117`
- JCB: `3566 1111 1111 1113`

Note: Cybersource formats some cards with X = 0 (e.g., `3782 8224 631X XX5` → `3782 8224 6310 005`).

## Braintree / Authorize.net

- Visa: `4111 1111 1111 1111`
- Amex: `3782 8224 6310 005`
- Authorize.net Visa: `4222 2222 2222 2222`
- Authorize.net Amex: `3700 0000 0000 002`

## Generic Test Data (any provider)

- Name: `Test Boss` / `John Doe`
- Email: `test@example.com`
- Expiry: `12/34`
- CVC: `123` (Amex: `1234`)
- ZIP: `10001` / `90210`
- Address: `123 Test St`

## Luhn Check (validation)

```python
def luhn_valid(num: str) -> bool:
    digits = [int(d) for d in num if d.isdigit()]
    checksum = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        checksum += d
    return checksum % 10 == 0

assert luhn_valid("4242424242424242")
assert not luhn_valid("4242424242424241")
```

## Workflow

1. Identify the payment provider (Stripe/PayPal/Braintree/Cybersource/other) — check the code (API keys, SDK imports, webhook URLs)
2. If unspecified, default to the Stripe test card. If the boss provided a real card for final verification, use the card the boss provided.
3. Use the card in the checkout flow, record the result (status code, charge ID, error)
4. Test both success and decline scenarios (using the decline cards) — evidence-gated: report the ACTUAL result
5. If sandbox credentials (API keys) are missing, label UNAVAILABLE and provide the complete runnable setup + test card table

## Sources

- Stripe: https://docs.stripe.com/testing
- PayPal: https://developer.paypal.com/tools/sandbox/card-testing/
- Cybersource: https://developer.cybersource.com/docs/cybs/en-us/payments/developer/ctv/so/payments/payments-intro/payments-testing-services/payments-testing-cards.html
- Braintree: https://developer.paypal.com/braintree/docs/guides/credit-cards/testing-go-live/node
- Authorize.net: https://developer.authorize.net/hello_world/testing_guide/
