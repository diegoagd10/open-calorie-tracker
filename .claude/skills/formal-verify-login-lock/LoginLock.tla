---- MODULE LoginLock ----
(* login() in apps/api/src/auth/auth.service.ts, for one attempts key (IP and username). *)
EXTENDS Naturals

CONSTANTS Design, MaxFailedAttempts, MaxArrivals

VARIABLES
  failures,          (* Attempts.failures *)
  checking,          (* Attempts.checking, the slots that running checks hold *)
  lock,              (* Attempts.lockedUntil: unset, in the future, or past *)
  wrong, right,      (* checks that run now, by what they will find *)
  guesses,           (* checks started since the last reset *)
  letInWhileLocked,
  arrivals

vars == <<failures, checking, lock, wrong, right, guesses, letInWhileLocked, arrivals>>

Designs == {"ReserveFirst", "CountAfterCheck", "LeakOnError"}
ASSUME Design \in Designs

Running == wrong + right
Reserves == Design # "CountAfterCheck"

Init ==
  /\ failures = 0 /\ checking = 0 /\ lock = "none"
  /\ wrong = 0 /\ right = 0 /\ guesses = 0
  /\ letInWhileLocked = FALSE /\ arrivals = 0

Expired == lock = "past"
SlotsFull == Reserves /\ ~Expired /\ failures + checking >= MaxFailedAttempts

(* From the start of login() to its first await. *)
Arrive ==
  /\ arrivals < MaxArrivals
  /\ lock # "active" /\ ~SlotsFull
  /\ arrivals' = arrivals + 1
  /\ guesses' = guesses + 1
  /\ failures' = IF Expired THEN 0 ELSE failures
  /\ checking' = IF Reserves THEN (IF Expired THEN 0 ELSE checking) + 1 ELSE 0
  /\ lock' = "none"
  /\ UNCHANGED letInWhileLocked

ArriveWrong == Arrive /\ wrong' = wrong + 1 /\ UNCHANGED right
ArriveRight == Arrive /\ right' = right + 1 /\ UNCHANGED wrong

RefuseLocked == lock = "active" /\ UNCHANGED vars
RefuseFull == lock # "active" /\ SlotsFull /\ UNCHANGED vars

(* From the end of the password check to the response. *)
FreeSlot == checking' = IF Reserves THEN checking - 1 ELSE 0

WrongCounted ==
  /\ wrong > 0 /\ failures + 1 < MaxFailedAttempts
  /\ wrong' = wrong - 1 /\ failures' = failures + 1 /\ FreeSlot
  /\ lock' = "none"
  /\ UNCHANGED <<right, guesses, letInWhileLocked, arrivals>>

WrongLocks ==
  /\ wrong > 0 /\ failures + 1 >= MaxFailedAttempts
  /\ wrong' = wrong - 1 /\ failures' = failures + 1 /\ FreeSlot
  /\ lock' = "active"
  /\ UNCHANGED <<right, guesses, letInWhileLocked, arrivals>>

RightConfirmed ==
  /\ right > 0
  /\ right' = right - 1 /\ failures' = 0 /\ FreeSlot
  /\ lock' = "none"
  /\ guesses' = Running - 1
  /\ letInWhileLocked' = (letInWhileLocked \/ lock = "active")
  /\ UNCHANGED <<wrong, arrivals>>

(* The lookup or the check throws, so the login answers 500 and reveals nothing. *)
CheckThrows ==
  /\ wrong > 0
  /\ wrong' = wrong - 1 /\ guesses' = guesses - 1
  /\ IF Design = "LeakOnError" THEN UNCHANGED checking ELSE FreeSlot
  /\ UNCHANGED <<failures, lock, right, letInWhileLocked, arrivals>>

LockRunsOut ==
  /\ lock = "active"
  /\ lock' = "past" /\ guesses' = Running
  /\ UNCHANGED <<failures, checking, wrong, right, letInWhileLocked, arrivals>>

Done == arrivals = MaxArrivals /\ Running = 0 /\ UNCHANGED vars

Next ==
  \/ ArriveWrong \/ ArriveRight \/ RefuseLocked \/ RefuseFull
  \/ WrongCounted \/ WrongLocks \/ RightConfirmed \/ CheckThrows
  \/ LockRunsOut \/ Done

Spec == Init /\ [][Next]_vars

GuessLimit == guesses <= MaxFailedAttempts
LockHolds == ~letInWhileLocked
NotShutOut == (Running = 0 /\ lock # "active") => ~SlotsFull
====
