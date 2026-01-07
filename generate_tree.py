import os

def generate_tree(startpath):
    """
    Generates a visual tree structure of the project while excluding specific folders.
    """
    # Add any folder names you want to exclude to this set
    exclude_dirs = {
        'modules', 
        'node_modules', 
        '.git', 
        '__pycache__', 
        '.vscode',
        'dist',
        'build'
    }

    print(f"Project Structure: {os.path.basename(os.path.abspath(startpath)) or startpath}")
    print("=" * 40)
    
    for root, dirs, files in os.walk(startpath):
        # Modify dirs in-place to skip excluded directories in subsequent iterations
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        
        # Calculate depth for indentation
        level = root.replace(startpath, '').count(os.sep)
        indent = '│   ' * level
        
        # Print the current directory
        if root != startpath:
            print(f'{indent}├── {os.path.basename(root)}/')
        
        # Print the files in this directory
        sub_indent = '│   ' * (level + 1)
        for i, f in enumerate(files):
            connector = '└── ' if i == len(files) - 1 else '├── '
            print(f'{sub_indent}{connector}{f}')

if __name__ == "__main__":
    # Run the generator in the current directory
    generate_tree('.')
    