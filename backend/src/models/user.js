module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'User',
    {
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      displayName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM('admin', 'editor'),
        allowNull: false,
        defaultValue: 'editor',
      },
      status: {
        type: DataTypes.ENUM('pending', 'active'),
        allowNull: false,
        defaultValue: 'pending',
      },
    },
    {
      tableName: 'users',
    },
  );
