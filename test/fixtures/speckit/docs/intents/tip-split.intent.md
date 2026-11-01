---
status: "approved"
---
# Intent: Split a restaurant bill and tip fairly between diners

## Constraints
- Amounts are integer cents, never floats
- Rounding remainder goes to the first diner

## Failure conditions
* Shares do not add up to the total
- A diner is charged a negative amount

## Out of scope
- Currency conversion
