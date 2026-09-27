# Synthetic LVCF 3 golden files

These three checked-in files contain only synthetic compatibility test data. Their public test credentials are `Golden fixture password!` and `LL3-` followed by 64 `1` characters. They must never be used to store real data.

Keep the bytes stable: tests ensure future readers preserve the LVCF 3 wire format and both unlock paths. Changing the protocol requires explicit migration and additional fixtures, rather than regenerating these files to make a test pass.
