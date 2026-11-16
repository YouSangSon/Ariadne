pub const MAX_COMMITS: usize = 1500;
pub const MAX_FILES_PER_COMMIT: usize = 25;
pub const MAX_FILES: u32 = 37500;
pub const MAX_PAIRS: usize = 450000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoChangeInput {
    pub file_count: u32,
    pub commits: Vec<Vec<u32>>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairCount {
    pub a: u32,
    pub b: u32,
    pub count: u32,
    pub first_seen_ordinal: u32,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoChangeCounts {
    pub frequencies: Vec<u32>,
    pub pairs: Vec<PairCount>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CountError {
    InvalidInput,
    LimitExceeded,
    Cancelled,
}

pub fn validate_input(input: &CoChangeInput) -> Result<(), CountError> {
    if input.file_count > MAX_FILES || input.commits.len() > MAX_COMMITS {
        return Err(self::CountError::LimitExceeded);
    }
    for commit in &input.commits {
        if commit.len() > MAX_FILES_PER_COMMIT {
            return Err(self::CountError::LimitExceeded);
        }
        if commit.iter().any(|id| *id >= input.file_count)
            || commit.windows(2).any(|w| w[0] >= w[1])
        {
            return Err(self::CountError::InvalidInput);
        }
    }
    Ok(())
}
pub fn count_reference(input: &CoChangeInput) -> Result<CoChangeCounts, CountError> {
    count_cancellable(input, || false)
}
pub fn count_cancellable(
    input: &CoChangeInput,
    mut cancelled: impl FnMut() -> bool,
) -> Result<CoChangeCounts, CountError> {
    validate_input(input)?;
    if cancelled() {
        return Err(self::CountError::Cancelled);
    }
    let mut counts = CoChangeCounts {
        frequencies: vec![0; input.file_count as usize],
        pairs: vec![],
    };
    let mut pairs = std::collections::BTreeMap::<(u32, u32), PairCount>::new();
    for commit in &input.commits {
        if cancelled() {
            return Err(self::CountError::Cancelled);
        }
        for id in commit {
            counts.frequencies[*id as usize] += 1;
        }
        for (i, a) in commit.iter().enumerate() {
            for b in &commit[i + 1..] {
                let ordinal = pairs.len();
                let pair = pairs.entry((*a, *b)).or_insert_with(|| PairCount {
                    a: *a,
                    b: *b,
                    count: 0,
                    first_seen_ordinal: ordinal as u32,
                });
                pair.count += 1;
            }
        }
    }
    if pairs.len() > MAX_PAIRS {
        return Err(self::CountError::LimitExceeded);
    }
    counts.pairs.reserve(pairs.len());
    for pair in pairs.into_values() {
        if cancelled() {
            return Err(self::CountError::Cancelled);
        }
        counts.pairs.push(pair);
    }
    Ok(counts)
}

// Checks structure and bounds without repeating the kernel.
pub fn validate_counts(input: &CoChangeInput, counts: &CoChangeCounts) -> Result<(), CountError> {
    validate_input(input)?;
    if counts.frequencies.len() != input.file_count as usize
        || counts
            .frequencies
            .iter()
            .any(|f| *f > input.commits.len() as u32)
    {
        return Err(self::CountError::InvalidInput);
    }
    if counts.pairs.len() > MAX_PAIRS {
        return Err(self::CountError::LimitExceeded);
    }
    let mut ordinals = vec![false; counts.pairs.len()];
    for (i, pair) in counts.pairs.iter().enumerate() {
        if pair.a >= pair.b
            || pair.b >= input.file_count
            || pair.count == 0
            || pair.count > counts.frequencies[pair.a as usize]
            || pair.count > counts.frequencies[pair.b as usize]
            || pair.first_seen_ordinal as usize >= ordinals.len()
            || ordinals[pair.first_seen_ordinal as usize]
        {
            return Err(self::CountError::InvalidInput);
        }
        if i > 0 {
            let prev = &counts.pairs[i - 1];
            if (prev.a, prev.b) >= (pair.a, pair.b) {
                return Err(self::CountError::InvalidInput);
            }
        }
        ordinals[pair.first_seen_ordinal as usize] = true;
    }
    Ok(())
}
