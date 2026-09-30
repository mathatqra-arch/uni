-- NexFlow 2.0.0 / 018: dedicated asset account for payments made outside the register.
INSERT OR IGNORE INTO general_accounts (id,code,name,name_ar,account_type,is_system)
VALUES ('ga-cash-outside','1005','Cash Outside Register','نقدية خارج الخزنة','ASSET','true');
