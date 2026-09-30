/**
 * Automatic General Ledger builder.
 *
 * Domain handlers call this module after calculating real operational values.
 * It owns only journal construction/validation; SQLite execution stays in the
 * desktop orchestrator so each business operation remains atomic.
 */
import { generateUUID } from '../ids'
import { round2, sqlVals } from './sql'

export function autoJournalStatements(args: {
  entryId: string
  clientTxnId: string
  entryNo: string
  entryDate: string
  description: string
  referenceType: string
  referenceId: string
  userId: string
  lines: Array<{accountId:string; debit?:number; credit?:number; note?:string}>
}): string[] {
  const lines = args.lines.filter(l => Math.max(Number(l.debit||0), Number(l.credit||0)) > 0)
  const debit = round2(lines.reduce((s,l)=>s+Math.max(0,Number(l.debit||0)),0))
  const credit = round2(lines.reduce((s,l)=>s+Math.max(0,Number(l.credit||0)),0))
  if (debit === 0 && credit === 0) return []
  if (debit <= 0 || Math.abs(debit-credit) > 0.009) throw new Error(`فشل إنشاء القيد التلقائي: القيد غير متوازن (${debit} مقابل ${credit})`)
  const stmts = [
    `INSERT INTO general_journal_entries (id,client_txn_id,entry_no,entry_date,description,reference_type,reference_id,user_id,status,entry_source,created_at,updated_at) VALUES ${sqlVals([args.entryId,args.clientTxnId,args.entryNo,args.entryDate,args.description,args.referenceType,args.referenceId,args.userId,'POSTED','AUTOMATIC',args.entryDate,args.entryDate])}`
  ]
  for (const l of lines) {
    stmts.push(`INSERT INTO general_journal_lines (id,journal_entry_id,account_id,debit,credit,note) VALUES ${sqlVals([generateUUID(),args.entryId,l.accountId,round2(l.debit||0),round2(l.credit||0),l.note||''])}`)
  }
  return stmts
}

export function makeJournalEntryNo(prefix:string, clientTxnId:string, now:string): string {
  return `${prefix}-${now.replace(/\D/g,'').slice(-12)}-${clientTxnId.slice(0,8)}`
}

