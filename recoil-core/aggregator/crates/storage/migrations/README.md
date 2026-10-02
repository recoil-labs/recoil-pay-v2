# Migrations are immutable once applied

sqlx records a checksum of every migration file it has run. Editing an
applied one — *including its comments* — makes the aggregator refuse to
start with:

    Migration failed: migration <version> was previously applied but has
    been modified

That is not a warning. The process panics and the API goes down.

`20260729000000_operator_api_key.sql` therefore still names the old
hard-coded admin key in a comment, and is the only place in this
repository that mentions the previous brand. It cannot be reworded
without breaking every deployment that has already run it. A
rebrand sweep edited that one word and took the API down; this file
exists so the next one does not.

To change an applied migration you have to add a new one instead.
