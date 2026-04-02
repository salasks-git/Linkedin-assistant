---
description: Stage all changes (or specified files), generate a commit message, and commit with a tag.
---
# Commit Workflow

// turbo-all

This workflow handles committing your changes. You can specify specific files to commit, or it will automatically stage all changes if none are specified.

## Usage

- `/commit`: Stages all modified and new files.
- `/commit <file1> <file2> ...`: Stages only the specified files.
- `/commit all`: Stages all modified and new files.

## Steps

1. **Stage Changes**: Stage specifying files or use `.` for all.

   ```bash
   git add <files_or_dot>
   ```

2. **Analyze Changes**: Get the diff of staged changes to understand the context.

   ```bash
   git diff --cached
   ```

3. **Generate & Commit**: Generate a professional message following [Conventional Commits](https://www.conventionalcommits.org/) and execute the commit.

   ```bash
   git commit -m "<ai_generated_message>"
   ```

4. **Check Latest Tag**: Identify the most recent version tag to ensure the next tag is a proper increment.

   ```bash
   git tag --sort=-v:refname | head -n 1
   ```

5. **Tag the Release**: Tag the current commit with an incremented version number based on the latest tag (e.g., if latest was v1.0.0, the next is v1.1.0 or v2.0.0).

   ```bash
   git tag <version_tag>
   ```
