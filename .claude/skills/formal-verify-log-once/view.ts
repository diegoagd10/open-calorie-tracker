type Variables = {
  dialog: 'form' | 'sending' | 'error' | 'closed'
  answering: boolean
  rows: Record<string, number>
  presses: number
  savedLast: boolean
  listIsTrue: boolean
}

export const title = 'Adding one entry'

const DIALOGS = {
  form: 'Filling the form',
  sending: 'Sending',
  error: 'Error shown',
  closed: 'Dialog closed',
}

const logOf = ({ rows, presses, savedLast }: Variables) => {
  const entries = Object.values(rows)
  if (entries.length === 0) return 'not in the log'
  if (entries.length > 1) return 'in the log more than once'
  return savedLast && entries[0] !== presses ? 'in the log with old values' : 'in the log once'
}

export const state = (variables: Variables) => {
  const { dialog, answering, listIsTrue } = variables
  const shown = answering ? 'Saved, answer on its way' : DIALOGS[dialog]
  return `${shown}, ${logOf(variables)}${listIsTrue ? '' : ' but not on the page'}`
}

const LABELS: Record<string, string> = {
  PressAdd: 'you press Add',
  Arrive1: 'the API saves the entry',
  Arrive2: 'the API saves the entry',
  Arrive3: 'the API saves the entry',
  AnswerArrives: 'the answer arrives',
  AnswerLost: 'the answer is lost',
  RequestLost: 'the request is lost or late',
  RequestLate: 'the request is lost or late',
  Cancel: 'you press Cancel',
}

export const step = (action: string) => LABELS[action] ?? null
