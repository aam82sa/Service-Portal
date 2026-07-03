-- doa_matrix had no unique constraint, so repeated seed runs created
-- duplicate band rows and broke approval-chain generation.
-- Dedupe, then enforce uniqueness (NULLS NOT DISTINCT so the platform-wide
-- null dept/service bands are also protected).

delete from doa_matrix a using doa_matrix b
where a.id > b.id
  and a.min_amount = b.min_amount
  and a.max_amount is not distinct from b.max_amount
  and a.step_order = b.step_order
  and a.dept is not distinct from b.dept
  and a.service_id is not distinct from b.service_id;

create unique index doa_matrix_band_step
  on doa_matrix (dept, service_id, min_amount, step_order)
  nulls not distinct;
