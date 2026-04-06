module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Player',
    {
      displayName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      avatar: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'emoji:🎉',
      },
      preferredLanguage: {
        type: DataTypes.ENUM('en', 'ru'),
        allowNull: false,
        defaultValue: 'en',
      },
      rejoinCode: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      socketId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      isConnected: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      lastSeenAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'players',
    },
  );
