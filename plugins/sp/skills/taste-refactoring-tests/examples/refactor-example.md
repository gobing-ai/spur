# Worked Example — From Green Tests to Earned Confidence

## Production behavior
A transfer service should:
- reject transfers larger than the available balance,
- leave balances unchanged on rejection,
- debit the source and credit the destination on success,
- never execute the same transfer twice for the same idempotency key.

## Before: misleading tests

```pseudo
test "transfer works" {
  repo = mock()
  repo.getBalance("A").returns(100)
  repo.save(any()).returns(true)

  service.transfer("A", "B", 60)

  verify(repo).save(any())
}
```

Why this is weak:
- no result is asserted,
- balances are not asserted,
- wrong amounts can still pass,
- duplicate execution is not checked,
- rejection behavior is absent,
- the mock is configured so the interaction succeeds.

Classification: **T3 STRENGTHEN**, plus **T5 ADD MISSING PROTECTION**.

## After: behavior-focused tests

```pseudo
test "debits source and credits destination for a valid transfer" {
  repo = FakeAccountRepository({A: 100, B: 20})
  service = TransferService(repo)

  result = service.transfer("tx-1", "A", "B", 60)

  assert result == Success
  assert repo.balance("A") == 40
  assert repo.balance("B") == 80
}
```

```pseudo
test "rejects transfer when funds are insufficient and changes nothing" {
  repo = FakeAccountRepository({A: 50, B: 20})
  service = TransferService(repo)

  result = service.transfer("tx-2", "A", "B", 60)

  assert result == InsufficientFunds
  assert repo.balance("A") == 50
  assert repo.balance("B") == 20
}
```

```pseudo
test "same idempotency key is applied only once" {
  repo = FakeAccountRepository({A: 100, B: 20})
  service = TransferService(repo)

  service.transfer("tx-3", "A", "B", 60)
  service.transfer("tx-3", "A", "B", 60)

  assert repo.balance("A") == 40
  assert repo.balance("B") == 80
}
```

## Plausible fault challenge
Introduce these temporary faults and confirm tests fail:
- change insufficient-funds comparison from `amount > balance` to `amount >= balance`,
- debit 50 instead of requested amount,
- omit destination credit,
- ignore idempotency key.

If a fault survives, strengthen the relevant test before declaring the suite trustworthy.

## Result
The refactored tests are fewer in implementation assertions but stronger in behavior protection. They can remain stable if repository internals change, while still failing when transfer semantics break.
