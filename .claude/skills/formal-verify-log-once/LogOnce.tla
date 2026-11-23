---- MODULE LogOnce ----
(* One Add dialog of the Food Log, from opening to closing. *)
EXTENDS Naturals, Sequences

CONSTANTS Design, MaxPresses

VARIABLES
  dialog,      (* what the dialog shows *)
  presses,     (* presses of Add, and the values the last one sent *)
  travelling,  (* travelling[p]: the request of press p has not reached the API yet *)
  answering,   (* the API saved the last press, and its answer is on the way *)
  rows,        (* the entries in the database, each as the press whose values it has *)
  list,        (* the entries on the page *)
  savedLast,   (* the request of the last press reached the API *)
  listIsTrue   (* when the dialog closed, the page showed the database *)

vars == <<dialog, presses, travelling, answering, rows, list, savedLast, listIsTrue>>

Designs == {"RequestId", "InsertEveryPress", "FirstArrivalWins", "LastArrivalWins", "NoReloadOnCancel"}
ASSUME Design \in Designs

Presses == 1..MaxPresses

Init ==
  /\ dialog = "form" /\ presses = 0
  /\ travelling = [p \in Presses |-> FALSE] /\ answering = FALSE
  /\ rows = <<>> /\ list = <<>>
  /\ savedLast = FALSE /\ listIsTrue = TRUE

Open == dialog \in {"form", "error"}

PressAdd ==
  /\ Open /\ presses < MaxPresses
  /\ dialog' = "sending" /\ presses' = presses + 1
  /\ travelling' = [travelling EXCEPT ![presses + 1] = TRUE]
  /\ savedLast' = FALSE
  /\ UNCHANGED <<answering, rows, list, listIsTrue>>

(* The INSERT of the API, one SQL statement. *)
Save(p) ==
  IF Design = "InsertEveryPress" THEN Append(rows, p)
  ELSE IF rows = <<>> THEN <<p>>
  ELSE IF Design = "FirstArrivalWins" THEN rows
  ELSE IF Design = "LastArrivalWins" THEN <<p>>
  ELSE IF p > rows[1] THEN <<p>> ELSE rows

Arrive(p) ==
  /\ travelling[p]
  /\ travelling' = [travelling EXCEPT ![p] = FALSE]
  /\ rows' = Save(p)
  /\ answering' = (answering \/ (dialog = "sending" /\ p = presses))
  /\ savedLast' = (savedLast \/ p = presses)
  /\ UNCHANGED <<dialog, presses, list, listIsTrue>>

Arrive1 == MaxPresses >= 1 /\ Arrive(1)
Arrive2 == MaxPresses >= 2 /\ Arrive(2)
Arrive3 == MaxPresses >= 3 /\ Arrive(3)

Close(shown) ==
  /\ dialog' = "closed"
  /\ list' = shown /\ listIsTrue' = (shown = rows)

AnswerArrives ==
  /\ answering /\ answering' = FALSE
  /\ Close(rows)
  /\ UNCHANGED <<presses, travelling, rows, savedLast>>

AnswerLost ==
  /\ answering /\ answering' = FALSE
  /\ dialog' = "error"
  /\ UNCHANGED <<presses, travelling, rows, list, savedLast, listIsTrue>>

Waiting == dialog = "sending" /\ travelling[presses]

RequestLost ==
  /\ Waiting
  /\ travelling' = [travelling EXCEPT ![presses] = FALSE]
  /\ dialog' = "error"
  /\ UNCHANGED <<presses, answering, rows, list, savedLast, listIsTrue>>

(* The page stops waiting, and the request may still reach the API. *)
RequestLate ==
  /\ Waiting
  /\ dialog' = "error"
  /\ UNCHANGED <<presses, travelling, answering, rows, list, savedLast, listIsTrue>>

Reloads == Design \notin {"InsertEveryPress", "NoReloadOnCancel"} /\ dialog = "error"

Cancel ==
  /\ Open
  /\ Close(IF Reloads THEN rows ELSE list)
  /\ UNCHANGED <<presses, travelling, answering, rows, savedLast>>

Done == dialog = "closed" /\ (\A p \in Presses : ~travelling[p]) /\ UNCHANGED vars

Next ==
  \/ PressAdd \/ Arrive1 \/ Arrive2 \/ Arrive3
  \/ AnswerArrives \/ AnswerLost \/ RequestLost \/ RequestLate \/ Cancel \/ Done

Spec == Init /\ [][Next]_vars

OneEntry == Len(rows) <= 1
LastPressWins == savedLast => \A i \in DOMAIN rows : rows[i] = presses
ListIsTrue == listIsTrue
====
